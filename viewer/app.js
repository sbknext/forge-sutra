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
    var models = sortModels(filterModels(cardModels), sortKey);
    document.getElementById("feature-grid").innerHTML = models
      .map(function (m) {
        return buildFeatureCard(m);
      })
      .join("\n");
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

  document.getElementById("btn-reload").addEventListener("click", loadGraph);
  document.getElementById("sort-key").addEventListener("change", renderGrid);

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
  }

  window.addEventListener("hashchange", handleRoute);

  loadGraph();

  /* Story 3.5 — live push via SSE when /events is available */
  if (typeof EventSource !== "undefined") {
    try {
      var es = new EventSource("/events");
      es.addEventListener("graph", function (ev) {
        try {
          var graph = JSON.parse(ev.data);
          if (graph.version === GRAPH_VERSION) {
            renderGraph(graph);
            handleRoute();
            document.getElementById("live-status").textContent = "Live · updated " + graph.scanned_at;
          }
        } catch (_) {
          /* ignore malformed push */
        }
      });
      es.addEventListener("scan-error", function (ev) {
        try {
          var data = JSON.parse(ev.data);
          document.getElementById("live-status").textContent =
            "Scan error (showing last good graph): " + (data.message || "unknown");
        } catch (_) {
          document.getElementById("live-status").textContent = "Scan error — showing last good graph";
        }
      });
      es.onopen = function () {
        document.getElementById("live-status").textContent = "Live · watching for changes";
      };
    } catch (_) {
      /* SSE not available — manual reload only */
    }
  }
})();
