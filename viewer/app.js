/**
 * Sutra viewer SPA — fetches graph.json, renders feature grid + detail panels.
 * Zero-build vanilla JS; local-first, single-user.
 */
(function () {
  "use strict";

  var GRAPH_VERSION = window.SUTRA_GRAPH_VERSION;
  var rendered = {};
  var activeCard = null;
  var currentGraph = null;
  var cardModels = [];
  var healthFilter = [];
  var filterState = {
    search: "",
    bands: [],
    unscored: true,
    confidence: 0,
    issueKinds: [],
  };

  function encodeFilterState() {
    return JSON.stringify({
      bands: healthFilter.slice().sort(),
      confidence: Number(Number(filterState.confidence).toFixed(2)),
      issueKinds: filterState.issueKinds.slice().sort(),
      search: filterState.search,
      unscored: filterState.unscored,
    });
  }

  function decodeFilterState(raw) {
    try {
      var parsed = JSON.parse(decodeURIComponent(raw.replace(/^#/, "")));
      filterState.search = parsed.search || "";
      filterState.confidence = parsed.confidence || 0;
      filterState.unscored = parsed.unscored !== false;
      filterState.issueKinds = parsed.issueKinds || [];
      healthFilter = parsed.bands || [];
    } catch (_) {
      /* ignore bad hash */
    }
  }

  function featureMatchesClient(model) {
    if (healthFilter.length > 0 || !filterState.unscored) {
      if (model.health === "unknown" && !filterState.unscored) return false;
      if (model.health !== "unknown" && healthFilter.length > 0 && healthFilter.indexOf(model.health) === -1)
        return false;
    }

    if (filterState.issueKinds.length > 0 && currentGraph) {
      var issues = currentGraph.issues.filter(function (i) {
        return i.feature === model.id;
      });
      if (!issues.some(function (i) {
        return filterState.issueKinds.indexOf(i.kind) !== -1;
      }))
        return false;
    }

    var q = (filterState.search || "").trim().toLowerCase();
    if (q) {
      var nameMatch =
        model.name.toLowerCase().indexOf(q) !== -1 ||
        model.feat.label.toLowerCase().indexOf(q) !== -1;
      var nodeMatch = false;
      if (currentGraph) {
        nodeMatch = currentGraph.nodes
          .filter(function (n) {
            return model.feat.node_ids.indexOf(n.id) !== -1;
          })
          .some(function (n) {
            return (
              n.name.toLowerCase().indexOf(q) !== -1 ||
              n.id.toLowerCase().indexOf(q) !== -1
            );
          });
      }
      if (!nameMatch && !nodeMatch) return false;
    }

    if (filterState.confidence > 0 && currentGraph) {
      var nodes = currentGraph.nodes.filter(function (n) {
        return model.feat.node_ids.indexOf(n.id) !== -1;
      });
      var ok = nodes.some(function (n) {
        return n.confidence !== undefined && n.confidence >= filterState.confidence;
      });
      var issOk = currentGraph.issues
        .filter(function (i) {
          return i.feature === model.id;
        })
        .some(function (i) {
          return i.confidence !== undefined && i.confidence >= filterState.confidence;
        });
      if (!ok && !issOk) return false;
    }

    return true;
  }

  function updateFilterReadout(visible, total) {
    var el = document.getElementById("filter-readout");
    if (!el || !currentGraph) return;
    el.textContent =
      "Showing " + visible + " of " + total + " features";
    var empty = document.getElementById("filter-empty");
    if (empty) {
      if (visible === 0 && total > 0) empty.classList.remove("hidden");
      else empty.classList.add("hidden");
    }
  }

  var HEALTH_RANK = { unhealthy: 0, warn: 1, unknown: 2, healthy: 3 };

  function bandToHealth(band, hasHealth) {
    if (!hasHealth || !band) return "unknown";
    if (band === "green") return "healthy";
    if (band === "amber") return "warn";
    if (band === "red") return "unhealthy";
    return "unknown";
  }

  function buildCardModels(graph) {
    var contractFeatures = {};
    for (var c = 0; c < graph.contracts.length; c++) {
      contractFeatures[graph.contracts[c].feature] = true;
    }
    return graph.features.map(function (feat) {
      var nodeIds = {};
      for (var i = 0; i < feat.node_ids.length; i++) nodeIds[feat.node_ids[i]] = true;
      var isAi = feat.label_source === "ai-inferred" && feat.ai_name;
      var hasHealth = feat.health && feat.health.band;
      return {
        id: feat.id,
        feat: feat,
        name: isAi ? feat.ai_name : feat.label,
        isAiName: !!isAi,
        aiSummary: isAi ? feat.ai_summary : undefined,
        nodeCount: feat.node_ids.length,
        edgeCount: edgeCount(graph, nodeIds),
        contractStatus: contractFeatures[feat.id] ? "has_contract" : "none",
        issueCount: feat.issue_count,
        health: bandToHealth(feat.health && feat.health.band, hasHealth),
        healthScore: feat.health && feat.health.score,
        healthBand: feat.health && feat.health.band,
      };
    });
  }

  function sortModels(models, key) {
    var out = models.slice();
    out.sort(function (a, b) {
      var cmp = 0;
      if (key === "health" || key === "health-best") {
        cmp = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
        if (key === "health-best") cmp = -cmp;
      } else if (key === "issues") {
        cmp = b.issueCount - a.issueCount;
      } else if (key === "name") {
        cmp = a.name.localeCompare(b.name);
      }
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });
    return out;
  }

  function filterModels(models) {
    if (!healthFilter.length) return models;
    return models.filter(function (m) {
      return healthFilter.indexOf(m.health) !== -1;
    });
  }

  function healthBadgeClass(health) {
    if (health === "healthy") return "badge-health-green";
    if (health === "warn") return "badge-health-amber";
    if (health === "unhealthy") return "badge-health-red";
    return "badge-ok";
  }

  function healthLabel(health) {
    if (health === "unknown") return "unknown";
    return health;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mermaidLabel(s) {
    var clean = String(s)
      .replace(/["'`]/g, "")
      .replace(/[(){}[\]<>;#\\]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    return '"' + clean + '"';
  }

  function mermaidShape(type) {
    switch (type) {
      case "route":
      case "endpoint":
        return ["([", "])"];
      case "component":
        return ["[/", "/]"];
      case "test":
        return ["{{", "}}"];
      case "handler":
      case "function":
        return ["[", "]"];
      default:
        return ["(", ")"];
    }
  }

  function edgeCount(graph, nodeIds) {
    var count = 0;
    for (var i = 0; i < graph.edges.length; i++) {
      var e = graph.edges[i];
      if (nodeIds[e.from] || nodeIds[e.to]) count++;
    }
    return count;
  }

  function buildMermaid(graph, nodeIds, truncated) {
    var lines = ["flowchart LR"];
    var safeid = function (id) {
      return "n" + id.replace(/[^a-zA-Z0-9]/g, "_");
    };
    var kindArrow = {
      calls: "-->",
      imports: "-.->",
      renders: "==>",
      tests: "--o",
      http: "--x",
    };

    for (var n = 0; n < graph.nodes.length; n++) {
      var node = graph.nodes[n];
      if (!nodeIds[node.id]) continue;
      var shape = mermaidShape(node.type);
      lines.push("  " + safeid(node.id) + shape[0] + mermaidLabel(node.name) + shape[1]);
    }

    for (var e = 0; e < graph.edges.length; e++) {
      var edge = graph.edges[e];
      if (!nodeIds[edge.from] || !nodeIds[edge.to]) continue;
      var arrow = kindArrow[edge.kind] || "-->";
      lines.push("  " + safeid(edge.from) + " " + arrow + " " + safeid(edge.to));
    }

    if (truncated) lines.push('  truncated["⚠ truncated — too many nodes"]');
    return lines.join("\n");
  }

  function formatIssueRow(iss) {
    var lowConf =
      iss.provenance === "template-prefix" ||
      (iss.confidence !== undefined && iss.confidence < 0.7);
    var extraClass = lowConf ? " issue-low-confidence" : "";
    var chip =
      iss.provenance !== undefined && iss.confidence !== undefined
        ? '<span class="prov-chip">' +
          esc(iss.provenance) +
          " · " +
          iss.confidence.toFixed(2) +
          "</span> "
        : "";
    return (
      '<li class="issue issue-' +
      esc(iss.severity) +
      extraClass +
      '"><span class="sev">' +
      esc(iss.severity.toUpperCase()) +
      "</span> " +
      chip +
      esc(iss.message) +
      "</li>"
    );
  }

  function buildDetailPanel(graph, feature, featureIssues) {
    var CAP = 60;
    var nodeIds = {};
    for (var i = 0; i < feature.node_ids.length; i++) nodeIds[feature.node_ids[i]] = true;
    var truncated = feature.node_ids.length > CAP;
    var capped = {};
    var ids = feature.node_ids.slice(0, CAP);
    for (var j = 0; j < ids.length; j++) capped[ids[j]] = true;

    var mermaidSrc = buildMermaid(graph, truncated ? capped : nodeIds, truncated);
    var issueRows = featureIssues.map(formatIssueRow).join("\n");

    return (
      '<div class="detail-panel" id="detail-' +
      esc(feature.id) +
      '" style="display:none">' +
      "<h3>" +
      esc(feature.label) +
      "</h3>" +
      '<p class="meta">' +
      feature.node_ids.length +
      " node(s)" +
      (truncated ? " — showing first " + CAP : "") +
      "</p>" +
      '<div class="mermaid-wrap"><pre class="mermaid" data-feature="' +
      esc(feature.id) +
      '">' +
      esc(mermaidSrc) +
      "</pre></div>" +
      (featureIssues.length > 0
        ? '<ul class="issue-list">' + issueRows + "</ul>"
        : '<p class="no-issues">No issues.</p>') +
      "</div>"
    );
  }

  function buildFeatureCard(model) {
    var feat = model.feat;
    var aiBadge = model.isAiName
      ? '<span class="badge badge-ai" title="ai-inferred label">AI</span>'
      : "";
    var contractBadge =
      model.contractStatus === "has_contract"
        ? '<span class="badge badge-contract" title="feature.sutra.md present">contract</span>'
        : '<span class="badge badge-no-contract" title="no contract file">no contract</span>';
    var summary = model.aiSummary
      ? '<div class="card-ai-summary">' + esc(model.aiSummary) + "</div>"
      : "";

    return (
      '<div class="card" data-feature="' +
      esc(feat.id) +
      '" tabindex="0" role="button" aria-expanded="false">' +
      '<div class="card-header"><span class="card-label">' +
      esc(model.name) +
      " " +
      aiBadge +
      '</span><span class="badge ' +
      healthBadgeClass(model.health) +
      '" title="Heuristic structural health">' +
      (model.healthScore != null ? model.healthScore + " · " : "") +
      esc(healthLabel(model.health)) +
      "</span></div>" +
      summary +
      '<div class="card-meta">' +
      model.nodeCount +
      " node(s) · " +
      model.edgeCount +
      " edge(s) · " +
      model.issueCount +
      " issue(s) · " +
      contractBadge +
      "</div>" +
      '<div class="card-health-note">Heuristic structural health score — not runtime correctness</div>' +
      "</div>"
    );
  }

  function indexIssues(issues) {
    var map = {};
    for (var i = 0; i < issues.length; i++) {
      var iss = issues[i];
      if (!map[iss.feature]) map[iss.feature] = [];
      map[iss.feature].push(iss);
    }
    return map;
  }

  function severityRank(sev) {
    return sev === "error" ? 0 : sev === "warn" ? 1 : 2;
  }

  function renderGrid() {
    if (!currentGraph) return;
    var sortKey = document.getElementById("sort-key").value;
    var filtered = cardModels.filter(featureMatchesClient);
    var models = sortModels(filtered, sortKey);
    document.getElementById("feature-grid").innerHTML = models
      .map(function (m) {
        return buildFeatureCard(m);
      })
      .join("\n");
    updateFilterReadout(models.length, cardModels.length);
    wireCards();
  }

  function renderGraph(graph) {
    currentGraph = graph;
    rendered = {};
    activeCard = null;

    document.getElementById("app-header").querySelector("h1").textContent =
      "Sutra — " + graph.repo;
    document.getElementById("header-meta").innerHTML =
      "Scanned: " +
      esc(graph.scanned_at) +
      " · Commit: <code>" +
      esc(graph.commit) +
      "</code>";
    document.getElementById("header-counts").innerHTML =
      "<span>" +
      graph.nodes.length +
      " nodes</span><span>" +
      graph.edges.length +
      " edges</span><span>" +
      graph.issues.length +
      " issues</span><span>" +
      graph.features.length +
      " features</span>";

    var issuesByFeature = indexIssues(graph.issues);
    cardModels = buildCardModels(graph);
    renderGrid();

    var panels = graph.features
      .map(function (feat) {
        var issues = (issuesByFeature[feat.id] || []).slice().sort(function (a, b) {
          return severityRank(a.severity) - severityRank(b.severity);
        });
        return buildDetailPanel(graph, feat, issues);
      })
      .join("\n");
    document.getElementById("detail-root").innerHTML = panels;

    document.getElementById("error-state").classList.add("hidden");
    setupHealthFilter();
    setupIssueKindFilter();
    syncFilterControls();
  }

  function syncFilterControls() {
    var search = document.getElementById("filter-search");
    if (search) search.value = filterState.search;
    var conf = document.getElementById("filter-confidence");
    if (conf) {
      conf.value = String(filterState.confidence);
      document.getElementById("conf-readout").textContent = Number(filterState.confidence).toFixed(2);
    }
  }

  function setupIssueKindFilter() {
    var el = document.getElementById("issue-kind-filter");
    if (!el || !currentGraph) return;
    var kinds = [];
    currentGraph.issues.forEach(function (i) {
      if (kinds.indexOf(i.kind) === -1) kinds.push(i.kind);
    });
    kinds.sort();
    el.innerHTML =
      "Issues: " +
      kinds
        .map(function (k) {
          return (
            '<label class="filter-chip"><input type="checkbox" data-kind="' +
            k +
            '"> ' +
            k +
            "</label>"
          );
        })
        .join(" ");
    el.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("change", function () {
        filterState.issueKinds = [];
        el.querySelectorAll("input:checked").forEach(function (cb) {
          filterState.issueKinds.push(cb.getAttribute("data-kind"));
        });
        renderGrid();
      });
    });
  }

  function setupHealthFilter() {
    var el = document.getElementById("health-filter");
    var states = ["unhealthy", "warn", "unknown", "healthy"];
    el.innerHTML =
      "Filter: " +
      states
        .map(function (s) {
          return (
            '<label class="filter-chip"><input type="checkbox" data-health="' +
            s +
            '"> ' +
            s +
            "</label>"
          );
        })
        .join(" ");
    el.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("change", function () {
        healthFilter = [];
        el.querySelectorAll("input:checked").forEach(function (cb) {
          healthFilter.push(cb.getAttribute("data-health"));
        });
        renderGrid();
      });
    });
  }

  function showError(msg) {
    var el = document.getElementById("error-state");
    el.textContent = msg;
    el.classList.remove("hidden");
    document.getElementById("feature-grid").innerHTML = "";
    document.getElementById("detail-root").innerHTML = "";
  }

  function loadGraph() {
    return fetch("/graph.json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (body) {
            throw new Error(body.error || "Failed to load graph.json");
          });
        }
        return res.json();
      })
      .then(function (graph) {
        if (graph.version !== GRAPH_VERSION) {
          throw new Error(
            "graph version mismatch — expected " +
              GRAPH_VERSION +
              ", got " +
              graph.version +
              ". Re-run scan.",
          );
        }
        renderGraph(graph);
        handleRoute();
      })
      .catch(function (err) {
        showError(String(err.message || err));
      });
  }

  function showDetail(featureId) {
    var panel = document.getElementById("detail-" + featureId);
    if (!panel) return;

    var allPanels = document.querySelectorAll(".detail-panel");
    for (var i = 0; i < allPanels.length; i++) allPanels[i].style.display = "none";

    if (activeCard) {
      activeCard.classList.remove("active");
      activeCard.setAttribute("aria-expanded", "false");
    }

    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (!rendered[featureId]) {
      rendered[featureId] = true;
      var pre = panel.querySelector(".mermaid");
      if (pre && window.mermaid) {
        mermaid.run({ nodes: [pre] });
      }
    }
  }

  function showGridView() {
    document.getElementById("view-grid").classList.remove("hidden");
    document.getElementById("view-drilldown").classList.add("hidden");
    location.hash = "";
  }

  function showDrilldown(featureId) {
    document.getElementById("view-grid").classList.add("hidden");
    var dd = document.getElementById("view-drilldown");
    dd.classList.remove("hidden");
    if (window.SutraDrilldown && currentGraph) {
      window.SutraDrilldown.render(dd, currentGraph, featureId, showGridView);
    }
  }

  function handleRoute() {
    var hash = location.hash.replace(/^#/, "");
    if (hash.indexOf("feature=") === 0 && currentGraph) {
      showDrilldown(decodeURIComponent(hash.slice(8)));
    } else {
      showGridView();
    }
  }

  function toggleCard(card) {
    var featureId = card.getAttribute("data-feature");
    location.hash = "feature=" + encodeURIComponent(featureId);
    handleRoute();
  }

  function wireCards() {
    var grid = document.getElementById("feature-grid");
    if (!grid) return;
    grid.onclick = function (e) {
      var card = e.target.closest(".card");
      if (card) toggleCard(card);
    };
    grid.onkeydown = function (e) {
      if (e.key === "Enter" || e.key === " ") {
        var card = e.target.closest(".card");
        if (card) {
          e.preventDefault();
          toggleCard(card);
        }
      }
    };
  }

  /* Story 1.5.3 — static mode gate.
   * When window.__SUTRA_STATIC__ is true (set by the share artifact), suppress:
   *   - EventSource / SSE live push
   *   - "Reload graph" button (no server to reload from)
   *   - "Live" badge (replaced by snapshot label in header)
   *   - "Export view" button (POST /export-view needs a live server)
   * "Share this view" button is kept but copy semantics change to local path + hash.
   */
  var IS_STATIC = !!window.__SUTRA_STATIC__;

  if (IS_STATIC) {
    var reloadBtn = document.getElementById("btn-reload");
    if (reloadBtn) reloadBtn.style.display = "none";
    var liveStatus = document.getElementById("live-status");
    if (liveStatus) liveStatus.style.display = "none";
    var exportBtn = document.getElementById("btn-export");
    if (exportBtn) exportBtn.style.display = "none";
  }

  document.getElementById("btn-reload").addEventListener("click", loadGraph);
  document.getElementById("sort-key").addEventListener("change", renderGrid);

  document.getElementById("filter-search").addEventListener("input", function (e) {
    filterState.search = e.target.value;
    renderGrid();
  });
  document.getElementById("filter-confidence").addEventListener("input", function (e) {
    filterState.confidence = parseFloat(e.target.value);
    document.getElementById("conf-readout").textContent = filterState.confidence.toFixed(2);
    renderGrid();
  });
  document.getElementById("btn-share").addEventListener("click", function () {
    var enc = encodeFilterState();
    location.hash = encodeURIComponent(enc);
    if (IS_STATIC) {
      /* Static artifact: copy local file path + hash.
       * Honest: this is a local path, not a hosted URL. */
      var localPath = (window.__SUTRA_SHARE_PATH__ || location.href) + location.hash;
      navigator.clipboard.writeText(localPath).catch(function () {});
      var shareBtn = document.getElementById("btn-share");
      if (shareBtn) {
        shareBtn.textContent = "Copied local path";
        setTimeout(function () { shareBtn.textContent = "Copy local path"; }, 2000);
      }
    } else {
      navigator.clipboard.writeText(location.href).catch(function () {});
    }
  });
  document.getElementById("btn-export").addEventListener("click", function () {
    fetch("/export-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: encodeFilterState() }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.path) alert("Exported → " + data.path);
      });
  });

  if (location.hash) decodeFilterState(location.hash);

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
  }

  window.addEventListener("hashchange", handleRoute);

  if (IS_STATIC) {
    /* Static mode: graph is already inlined as window.__SUTRA_GRAPH__ — render directly. */
    if (window.__SUTRA_GRAPH__) {
      renderGraph(window.__SUTRA_GRAPH__);
      handleRoute();
    }
    /* Update share button label to reflect local-path semantics */
    var shareBtn2 = document.getElementById("btn-share");
    if (shareBtn2) shareBtn2.textContent = "Copy local path";
  } else {
    loadGraph();

    if (window.SutraEcosystem) {
      window.SutraEcosystem.init(window.SUTRA_LINK_VERSION);
    }
  }

  /* Story 3.5 / 1.5.1 — live push via SSE when /events is available.
   * Suppressed in static mode (no server). */
  if (!IS_STATIC && typeof EventSource !== "undefined") {
    try {
      var es = new EventSource("/events");
      var highlightTimer = null;

      function setLiveConnected(msg) {
        var el = document.getElementById("live-status");
        if (!el) return;
        el.textContent = msg;
        el.classList.remove("live-disconnected");
        el.classList.add("live-connected");
      }

      function setLiveDisconnected(msg) {
        var el = document.getElementById("live-status");
        if (!el) return;
        el.textContent = msg;
        el.classList.remove("live-connected");
        el.classList.add("live-disconnected");
      }

      /**
       * Candidate UI: apply transient yellow highlight on changed feature cards.
       * "structure changed" = node set, issue count, or health score changed.
       * Auto-clears after 5 s. Not a semantic bug detector.
       */
      function applyChangedHighlights(changedIds) {
        if (!changedIds || !changedIds.length) return;
        if (highlightTimer) clearTimeout(highlightTimer);
        var grid = document.getElementById("feature-grid");
        if (!grid) return;
        for (var i = 0; i < changedIds.length; i++) {
          var id = changedIds[i];
          var cards = grid.querySelectorAll('[data-feature="' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id) + '"]');
          for (var j = 0; j < cards.length; j++) {
            cards[j].classList.add("card-changed");
            var existing = cards[j].querySelector(".card-changed-badge");
            if (!existing) {
              var badge = document.createElement("span");
              badge.className = "card-changed-badge";
              badge.title = "Candidate: structure changed (node set / issue count / health score) — not a semantic bug detector";
              badge.textContent = "structure changed";
              var header = cards[j].querySelector(".card-header");
              if (header) header.appendChild(badge);
            }
          }
        }
        highlightTimer = setTimeout(function () {
          var changed = grid.querySelectorAll(".card-changed");
          for (var k = 0; k < changed.length; k++) {
            changed[k].classList.remove("card-changed");
            var b = changed[k].querySelector(".card-changed-badge");
            if (b) b.remove();
          }
          highlightTimer = null;
        }, 5000);
      }

      es.addEventListener("graph", function (ev) {
        try {
          var payload = JSON.parse(ev.data);
          if (payload.version === GRAPH_VERSION) {
            var changedIds = payload.changedFeatureIds || [];
            renderGraph(payload);
            handleRoute();
            applyChangedHighlights(changedIds);
            setLiveConnected("Live · updated " + payload.scanned_at);
          }
        } catch (_) {
          /* ignore malformed push */
        }
      });
      es.addEventListener("scan-error", function (ev) {
        try {
          var data = JSON.parse(ev.data);
          setLiveConnected("Scan error (showing last good graph): " + (data.message || "unknown"));
        } catch (_) {
          setLiveConnected("Scan error — showing last good graph");
        }
      });
      es.onopen = function () {
        setLiveConnected("Live · watching for changes");
      };
      es.onerror = function () {
        setLiveDisconnected("Disconnected");
      };
    } catch (_) {
      /* SSE not available — manual reload only */
    }
  }
})();
