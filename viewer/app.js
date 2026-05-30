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

  function buildFeatureCard(graph, feat, issues) {
    var nodeIds = {};
    for (var i = 0; i < feat.node_ids.length; i++) nodeIds[feat.node_ids[i]] = true;
    var ec = edgeCount(graph, nodeIds);
    var healthBand =
      (feat.health && feat.health.band) ||
      (issues.length === 0
        ? "green"
        : issues.some(function (i) {
            return i.severity === "error";
          })
          ? "red"
          : "amber");
    var healthScore = (feat.health && feat.health.score) || 0;
    var isAi = feat.label_source === "ai-inferred" && feat.ai_name;
    var displayLabel = isAi ? feat.ai_name : feat.label;
    var aiBadge = isAi
      ? '<span class="badge badge-ai" title="ai-inferred label">AI</span>'
      : "";

    return (
      '<div class="card" data-feature="' +
      esc(feat.id) +
      '" tabindex="0" role="button" aria-expanded="false">' +
      '<div class="card-header"><span class="card-label">' +
      esc(displayLabel) +
      " " +
      aiBadge +
      '</span><span class="badge badge-health-' +
      esc(healthBand) +
      '" title="Heuristic structural health score">' +
      healthScore +
      " · " +
      esc(healthBand) +
      "</span></div>" +
      '<div class="card-meta">' +
      feat.node_ids.length +
      " node(s) · " +
      ec +
      " edge(s) · " +
      feat.issue_count +
      " issue(s)</div>" +
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
    var cards = graph.features
      .map(function (feat) {
        return buildFeatureCard(graph, feat, issuesByFeature[feat.id] || []);
      })
      .join("\n");
    document.getElementById("feature-grid").innerHTML = cards;

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
    wireCards();
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

  function toggleCard(card) {
    var featureId = card.getAttribute("data-feature");
    var panel = document.getElementById("detail-" + featureId);
    if (!panel) return;

    var isVisible = panel.style.display !== "none";
    if (isVisible && activeCard === card) {
      panel.style.display = "none";
      card.classList.remove("active");
      card.setAttribute("aria-expanded", "false");
      activeCard = null;
    } else {
      showDetail(featureId);
      card.classList.add("active");
      card.setAttribute("aria-expanded", "true");
      activeCard = card;
    }
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

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
  }

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
