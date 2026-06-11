/**
 * Story 3.3 — feature drill-down UI (Cytoscape interactive graph).
 * Logic mirrors src/viewer/subgraph.ts (browser cannot import TS).
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

  var CY_NODE_CAP = 120;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function inducedSubgraph(feature, graph) {
    var nodeSet = {};
    feature.node_ids.forEach(function (id) {
      nodeSet[id] = true;
    });
    graph.edges.forEach(function (e) {
      if (!nodeSet[e.from]) return;
      if (
        e.to.indexOf("http:") === 0 ||
        e.to.indexOf("PROXY") !== -1 ||
        !graph.nodes.some(function (n) {
          return n.id === e.to;
        })
      ) {
        nodeSet[e.to] = true;
      }
    });
    var subNodes = graph.nodes.filter(function (n) {
      return nodeSet[n.id];
    });
    var subEdges = graph.edges.filter(function (e) {
      return nodeSet[e.from] && nodeSet[e.to];
    });
    return { nodeSet: nodeSet, nodes: subNodes, edges: subEdges };
  }

  function flowMatchesFeature(feature, flow) {
    var nodeSet = {};
    feature.node_ids.forEach(function (id) {
      nodeSet[id] = true;
    });
    if (nodeSet[flow.entry]) return true;
    return (flow.steps || []).some(function (s) {
      return nodeSet[s.node];
    });
  }

  function featureFlows(graph, feature) {
    return (graph.flows || []).filter(function (f) {
      return flowMatchesFeature(feature, f);
    });
  }

  function featureContract(graph, featureId) {
    for (var i = 0; i < graph.contracts.length; i++) {
      if (graph.contracts[i].feature === featureId) return graph.contracts[i];
    }
    return null;
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

      var sub = inducedSubgraph(feature, graph);
      var isAi = feature.label_source === "ai-inferred" && feature.ai_name;
      var title = isAi ? feature.ai_name : feature.label;
      var aiBadge = isAi ? ' <span class="badge badge-ai">AI</span>' : "";

      var graphPanelHtml = buildGraphPanel(sub.nodes, sub.edges);
      var issuesHtml = buildIssues(graph, feature.id);
      var flowsHtml = buildFlows(graph, feature);
      var contractHtml = buildContractPanel(graph, feature.id, sub.nodes.length);

      container.innerHTML =
        '<div class="drilldown">' +
        '<div class="drilldown-header">' +
        '<button type="button" id="drilldown-back">← Back to grid</button>' +
        "<h2>" +
        esc(title) +
        aiBadge +
        "</h2>" +
        '<p class="meta">' +
        sub.nodes.length +
        " node(s) · " +
        sub.edges.length +
        " edge(s) · Heuristic / candidate — review before acting</p>" +
        "</div>" +
        buildLegendHtml() +
        graphPanelHtml +
        '<div id="node-detail" class="node-detail hidden"></div>' +
        contractHtml +
        issuesHtml +
        flowsHtml +
        buildExplainPanel(feature) +
        "</div>";

      document.getElementById("drilldown-back").onclick = function () {
        if (typeof onBack === "function") onBack();
      };
      wireExplainPanel(feature.id);

      var cyMount = document.getElementById("cy-root");
      if (sub.nodes.length > 0 && window.cytoscape) {
        try {
          initCy(sub.nodes, sub.edges);
        } catch (err) {
          if (cyMount) {
            cyMount.innerHTML =
              '<p class="error-state">Graph layout failed: ' +
              esc(String(err && err.message ? err.message : err)) +
              "</p>" +
              buildNodeListFallback(sub.nodes);
          }
        }
      } else if (sub.nodes.length > 0 && cyMount) {
        cyMount.innerHTML = buildNodeListFallback(sub.nodes);
      }
    },
  };

  function buildLegendHtml() {
    return (
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
      "</div>"
    );
  }

  function buildGraphPanel(nodes, edges) {
    if (nodes.length === 0) {
      return (
        '<div id="cy-root" class="cy-root cy-root-empty">' +
        '<p class="meta">No call-graph nodes for this feature — contract endpoints and issues below still apply.</p>' +
        "</div>"
      );
    }
    return '<div id="cy-root" class="cy-root"></div>';
  }

  function buildNodeListFallback(nodes) {
    var capped = nodes.slice(0, 40);
    return (
      '<p class="meta">Interactive graph unavailable — showing node ids (' +
      nodes.length +
      " total).</p><pre class='mermaid-fallback'>" +
      esc(
        capped
          .map(function (n) {
            return n.id;
          })
          .join("\n"),
      ) +
      (nodes.length > 40 ? "\n… +" + (nodes.length - 40) + " more" : "") +
      "</pre>"
    );
  }

  function buildContractPanel(graph, featureId, nodeCount) {
    var contract = featureContract(graph, featureId);
    if (!contract || !contract.endpoints || !contract.endpoints.length) {
      if (nodeCount > 0) return "";
      return (
        '<section class="drill-section"><h3>Contract endpoints</h3>' +
        '<p class="meta">No feature.sutra.md contract in graph.</p></section>'
      );
    }
    var html =
      '<section class="drill-section"><h3>Contract endpoints</h3>' +
      '<p class="meta">' +
      esc(contract.file || "") +
      " · " +
      contract.endpoints.length +
      " declared route(s)" +
      (nodeCount === 0 ? " — scan found 0 in-repo handlers for this feature card" : "") +
      "</p><ul class='contract-endpoints'>";
    contract.endpoints.forEach(function (ep) {
      html +=
        "<li><code>" +
        esc(ep.method) +
        " " +
        esc(ep.path) +
        "</code></li>";
    });
    html += "</ul></section>";
    return html;
  }

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
    var flows = featureFlows(graph, feature);
    if (!flows.length) {
      // AC3 (Story 8.6): explicit empty state referencing FLOW_KINDS so the user understands
      // why paths are absent — not a broken graph, just no renders/calls/http edges from an
      // entry point into this feature (imports-only or pre-8.1 extractor bench).
      return (
        '<section class="drill-section"><h3>Traced request paths</h3>' +
        '<p class="meta">No traced paths for this feature &mdash; flow tracing follows ' +
        '<code>renders</code>, <code>calls</code>, and <code>http</code> edges only ' +
        '(FLOW_KINDS). Endpoints are resolved but no outgoing edges were found from an ' +
        'entry node into this feature subgraph. Re-scan after extractor fixes or add a ' +
        '<code>calls</code> edge from a route handler to confirm paths.</p></section>'
      );
    }
    var html =
      '<section class="drill-section"><h3>Traced request paths</h3>' +
      '<p class="meta">' +
      flows.length +
      " path(s) — expand to read steps</p>";
    flows.forEach(function (flow, idx) {
      var steps = flow.steps || [];
      var summary =
        esc(flow.confidence) +
        " · entry <code>" +
        esc(shortId(flow.entry)) +
        "</code> → terminal <code>" +
        esc(shortId(flow.terminal)) +
        "</code> · " +
        steps.length +
        " step(s)";
      html +=
        '<details class="flow-path"' +
        (idx < 3 ? " open" : "") +
        ">" +
        "<summary>" +
        summary +
        "</summary><ol>";
      steps.forEach(function (step) {
        html += "<li><code>" + esc(shortId(step.node)) + "</code></li>";
      });
      html += "</ol></details>";
    });
    html += "</section>";
    return html;
  }

  // ── Story 1.5.4 — Explain this feature ───────────────────────────────────────

  /**
   * Build the Explain panel HTML for a feature drill-down.
   *
   * Gate rules:
   * - In static mode (window.__SUTRA_STATIC__): show "available in live viewer" note.
   * - In live mode: show Explain button with streaming text area.
   *
   * Honesty rule: AI label is structural, not opt-out.
   * Every explanation carries the mandatory "AI explanation — candidate" label.
   * The "Save to Brain" CTA is appended after explanation loads (per story DoD).
   */
  function buildExplainPanel(feature) {
    var isStatic = !!(window.__SUTRA_STATIC__);
    var html = '<section class="drill-section drill-explain" id="explain-section-' + esc(feature.id) + '">';
    html += '<h3>Explain this feature</h3>';

    if (isStatic) {
      // Static artifact: AI calls need a live server
      html += '<p class="explain-static-note">' +
        'AI explanation available in the live viewer (<code>forge-sutra watch</code>).' +
        '</p>';
    } else {
      html += '<button type="button" class="explain-btn" id="explain-btn-' + esc(feature.id) + '">' +
        'Explain (AI)' +
        '</button>';
      html += '<div class="explain-output hidden" id="explain-output-' + esc(feature.id) + '">' +
        '<div class="explain-label">' +
        'AI explanation — derived from code structure, not from documentation. ' +
        'Candidate — not a complete description.' +
        '</div>' +
        '<div class="explain-text" id="explain-text-' + esc(feature.id) + '"></div>' +
        '<div class="explain-brain-cta hidden" id="explain-cta-' + esc(feature.id) + '">' +
        'Save this explanation to Brain memory &mdash; <code>brain memory_save</code>' +
        '</div>' +
        '</div>';
    }

    html += '</section>';
    return html;
  }

  /**
   * Wire the Explain button for a feature drill-down.
   * Streams the AI response token-by-token via fetch + ReadableStream.
   * Candidate: streaming via fetch body reader (chunked transfer from server).
   */
  function wireExplainPanel(featureId) {
    var btn = document.getElementById("explain-btn-" + featureId);
    if (!btn) return; // static mode or already wired

    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Explaining…";

      var output = document.getElementById("explain-output-" + featureId);
      var textEl = document.getElementById("explain-text-" + featureId);
      var ctaEl = document.getElementById("explain-cta-" + featureId);

      if (output) output.classList.remove("hidden");
      if (textEl) textEl.textContent = "";

      // Encode featureId for URL (may contain slashes, hashes, etc.)
      var url = "/explain/" + encodeURIComponent(featureId);

      fetch(url, { method: "POST" })
        .then(function (res) {
          if (!res.ok) {
            return res.json().then(function (body) {
              var msg = (body && body.error) ? body.error : ("HTTP " + res.status);
              if (textEl) textEl.textContent = msg;
              btn.textContent = "Explain (AI)";
              btn.disabled = false;
            });
          }

          // Stream tokens
          var reader = res.body && res.body.getReader();
          if (!reader) {
            if (textEl) textEl.textContent = "(No streaming response body)";
            btn.textContent = "Explain (AI)";
            btn.disabled = false;
            return;
          }

          var decoder = new TextDecoder();
          var accumulated = "";

          function pump() {
            return reader.read().then(function (result) {
              if (result.done) {
                // Explanation complete — show Brain CTA
                if (ctaEl) ctaEl.classList.remove("hidden");
                btn.textContent = "Re-explain (AI)";
                btn.disabled = false;
                return;
              }
              var chunk = decoder.decode(result.value, { stream: true });
              accumulated += chunk;
              if (textEl) textEl.textContent = accumulated;
              return pump();
            });
          }

          return pump();
        })
        .catch(function (err) {
          if (textEl) textEl.textContent = "Explain error: " + String(err.message || err);
          btn.textContent = "Explain (AI)";
          btn.disabled = false;
        });
    });
  }

  function shortId(id) {
    var parts = String(id).split("::");
    return parts.length > 1 ? parts[parts.length - 1] : id;
  }

  function initCy(nodes, edges) {
    var mount = document.getElementById("cy-root");
    if (!mount) return;

    var useNodes = nodes;
    var truncated = false;
    if (nodes.length > CY_NODE_CAP) {
      truncated = true;
      useNodes = nodes.slice(0, CY_NODE_CAP);
    }
    var nodeIds = {};
    useNodes.forEach(function (n) {
      nodeIds[n.id] = true;
    });
    var useEdges = edges.filter(function (e) {
      return nodeIds[e.from] && nodeIds[e.to];
    });

    var cyNodes = useNodes.map(function (n) {
      return { data: { id: n.id, label: n.name, type: n.type, node: n } };
    });
    var cyEdges = useEdges.map(function (e, i) {
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
      container: mount,
      elements: { nodes: cyNodes, edges: cyEdges },
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "9px",
            "text-wrap": "ellipsis",
            "text-max-width": "70px",
            "background-color": "#6366f1",
            width: 72,
            height: 36,
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
            "font-size": "7px",
            "line-color": "#94a3b8",
            "target-arrow-color": "#94a3b8",
          },
        },
      ],
      layout: { name: "grid", padding: 16 },
      wheelSensitivity: 0.3,
    });

    if (useEdges.length > 0) {
      try {
        cy.layout({
          name: useNodes.length > 40 ? "cose" : "breadthfirst",
          directed: true,
          padding: 20,
          animate: false,
        }).run();
      } catch (_) {
        cy.layout({ name: "grid", padding: 16, animate: false }).run();
      }
    }

    if (truncated) {
      var note = document.createElement("p");
      note.className = "meta cy-truncated-note";
      note.textContent =
        "Showing first " + CY_NODE_CAP + " of " + nodes.length + " nodes — use search/filter on grid for smaller slices.";
      mount.parentNode.insertBefore(note, mount.nextSibling);
    }

    cy.on("tap", "node", function (evt) {
      var n = evt.target.data("node");
      var detail = document.getElementById("node-detail");
      if (!detail || !n) return;
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
