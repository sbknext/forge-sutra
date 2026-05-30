/**
 * Story 3.3 — feature drill-down UI (Cytoscape interactive graph).
 */
(function () {
  "use strict";

  var KIND_COLORS = {
    calls: "#6366f1",
    imports: "#64748b",
    renders: "#059669",
    tests: "#d97706",
    http: "#dc2626",
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  window.SutraDrilldown = {
    render: function (container, graph, featureId, onBack) {
      var feature = graph.features.find(function (f) {
        return f.id === featureId;
      });
      if (!feature) {
        container.innerHTML = "<p class='error-state'>Feature not found.</p>";
        return;
      }

      var nodeSet = {};
      feature.node_ids.forEach(function (id) {
        nodeSet[id] = true;
      });
      graph.edges.forEach(function (e) {
        if (nodeSet[e.from] && (e.to.indexOf("http:") === 0 || !graph.nodes.some(function (n) {
          return n.id === e.to;
        }))) {
          nodeSet[e.to] = true;
        }
      });

      var subEdges = graph.edges.filter(function (e) {
        return nodeSet[e.from] && nodeSet[e.to];
      });
      var subNodes = graph.nodes.filter(function (n) {
        return nodeSet[n.id];
      });

      var isAi = feature.label_source === "ai-inferred" && feature.ai_name;
      var title = isAi ? feature.ai_name : feature.label;
      var aiBadge = isAi ? ' <span class="badge badge-ai">AI</span>' : "";

      var issuesHtml = buildIssues(graph, feature.id);
      var flowsHtml = buildFlows(graph, feature);
      var legendHtml =
        '<div class="edge-legend">' +
        Object.keys(KIND_COLORS)
          .map(function (k) {
            return (
              '<span><i style="background:' +
              KIND_COLORS[k] +
              '"></i> ' +
              k +
              "</span>"
            );
          })
          .join("") +
        "</div>";

      container.innerHTML =
        '<div class="drilldown">' +
        '<div class="drilldown-header">' +
        '<button type="button" id="drilldown-back">← Back to grid</button>' +
        "<h2>" +
        esc(title) +
        aiBadge +
        "</h2>" +
        '<p class="meta">Heuristic / candidate — review before acting</p>' +
        "</div>" +
        legendHtml +
        '<div id="cy-root" class="cy-root"></div>' +
        '<div id="node-detail" class="node-detail hidden"></div>' +
        issuesHtml +
        flowsHtml +
        "</div>";

      document.getElementById("drilldown-back").onclick = onBack;

      if (window.cytoscape) {
        initCy(subNodes, subEdges);
      } else {
        document.getElementById("cy-root").innerHTML =
          "<pre class='mermaid-fallback'>" +
          esc(subNodes.map(function (n) {
            return n.id;
          }).join("\n")) +
          "</pre>";
      }
    },
  };

  function buildIssues(graph, featureId) {
    var issues = graph.issues.filter(function (i) {
      return i.feature === featureId;
    });
    if (!issues.length) {
      return '<section class="drill-section"><h3>Issues</h3><p class="no-issues">No issues.</p></section>';
    }
    var byKind = {};
    issues.forEach(function (iss) {
      if (!byKind[iss.kind]) byKind[iss.kind] = [];
      byKind[iss.kind].push(iss);
    });
    var html = '<section class="drill-section"><h3>Issues</h3>';
    Object.keys(byKind)
      .sort()
      .forEach(function (kind) {
        html += "<h4>" + esc(kind) + "</h4><ul class='issue-list'>";
        byKind[kind].forEach(function (iss) {
          var low =
            iss.provenance === "template-prefix" ||
            (iss.confidence !== undefined && iss.confidence < 0.7);
          var chip =
            iss.confidence !== undefined && iss.provenance
              ? '<span class="prov-chip">' +
                esc(iss.provenance) +
                " · " +
                iss.confidence.toFixed(2) +
                "</span> "
              : "";
          html +=
            '<li class="issue issue-' +
            iss.severity +
            (low ? " issue-low-confidence" : "") +
            '"><span class="sev">' +
            iss.severity.toUpperCase() +
            "</span> " +
            chip +
            esc(iss.message) +
            "</li>";
        });
        html += "</ul>";
      });
    html += "</section>";
    return html;
  }

  function buildFlows(graph, feature) {
    var flows = (graph.flows || []).filter(function (f) {
      return feature.node_ids.indexOf(f.entry) !== -1;
    });
    if (!flows.length) {
      return (
        '<section class="drill-section"><h3>Traced request paths</h3>' +
        '<p class="meta">No traced paths in this graph (static flow tracing may be absent).</p></section>'
      );
    }
    var html = '<section class="drill-section"><h3>Traced request paths</h3>';
    flows.forEach(function (flow) {
      html +=
        '<div class="flow-path"><span class="badge">' +
        esc(flow.confidence) +
        "</span> → terminal: " +
        esc(flow.terminal) +
        "<ol>";
      flow.steps.forEach(function (step) {
        html += "<li><code>" + esc(step.node) + "</code></li>";
      });
      html += "</ol></div>";
    });
    html += "</section>";
    return html;
  }

  function initCy(nodes, edges) {
    var cyNodes = nodes.map(function (n) {
      return { data: { id: n.id, label: n.name, type: n.type, node: n } };
    });
    var cyEdges = edges.map(function (e, i) {
      return {
        data: {
          id: "e" + i,
          source: e.from,
          target: e.to,
          kind: e.kind,
          label: e.kind,
        },
        classes: e.kind,
      };
    });

    var cy = cytoscape({
      container: document.getElementById("cy-root"),
      elements: { nodes: cyNodes, edges: cyEdges },
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "10px",
            "background-color": "#6366f1",
            width: 80,
            height: 40,
          },
        },
        {
          selector: "edge[kind = 'calls']",
          style: { "line-color": "#6366f1", "target-arrow-color": "#6366f1" },
        },
        {
          selector: "edge[kind = 'http']",
          style: { "line-color": "#dc2626", "target-arrow-color": "#dc2626" },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(kind)",
            "font-size": "8px",
            "line-color": "#94a3b8",
            "target-arrow-color": "#94a3b8",
          },
        },
      ],
      layout: { name: "breadthfirst", directed: true, padding: 20 },
      wheelSensitivity: 0.3,
    });

    cy.on("tap", "node", function (evt) {
      var n = evt.target.data("node");
      var detail = document.getElementById("node-detail");
      detail.classList.remove("hidden");
      detail.innerHTML =
        "<h4>" +
        esc(n.name) +
        "</h4>" +
        "<p><strong>id:</strong> <code>" +
        esc(n.id) +
        "</code></p>" +
        "<p><strong>type:</strong> " +
        esc(n.type) +
        "</p>" +
        "<p><strong>file:</strong> " +
        esc(n.file) +
        ":" +
        n.line +
        "</p>" +
        (n.data_shape
          ? "<p><strong>data_shape:</strong> " + esc(n.data_shape) + "</p>"
          : "");
    });
  }
})();
