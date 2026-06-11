/**
 * Story 3.4 — ecosystem cross-repo map view.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function splitCrossRepoId(id) {
    var idx = id.indexOf("::");
    if (idx === -1) return ["", id];
    return [id.slice(0, idx), id.slice(idx + 2)];
  }

  window.SutraEcosystem = {
    init: function (linkVersion) {
      var tab = document.getElementById("tab-ecosystem");
      if (!tab) return;

      fetch("/link.json", { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) {
            tab.classList.add("disabled");
            tab.title = "Run `sutra link` to build the ecosystem map";
            return null;
          }
          return res.json();
        })
        .then(function (link) {
          if (!link) return;
          if (link.version !== linkVersion) {
            tab.classList.add("disabled");
            tab.title = "link.json version mismatch — re-run link";
            return;
          }
          tab._sutraLink = link;
          tab.classList.remove("disabled");
          // AC2 (Story 8.6): reflect whether real cross-repo data is present.
          var hasEdges = link.edges && link.edges.length > 0;
          var hasMultiRepo = link.repos && link.repos.length >= 2;
          tab.title = (hasEdges && hasMultiRepo)
            ? "Cross-repo ecosystem map"
            : "Single-repo scan — run sutra link for cross-app map";
          tab.onclick = function () {
            window.SutraEcosystem.show(link);
          };
        })
        .catch(function () {
          tab.classList.add("disabled");
          tab.title = "Could not load link.json";
        });
    },

    show: function (link) {
      var root = document.getElementById("view-ecosystem");
      document.getElementById("view-grid").classList.add("hidden");
      document.getElementById("view-drilldown").classList.add("hidden");
      root.classList.remove("hidden");

      var showUnresolved = false;
      var edges = link.edges || [];
      var repos = link.repos || [];

      function render() {
        var html =
          '<div class="ecosystem">' +
          '<div class="drilldown-header">' +
          '<button type="button" id="eco-back">← Back to features</button>' +
          "<h2>Ecosystem map</h2>";

        if (edges.length === 0 || repos.length < 2) {
          // AC2 (Story 8.6): empty / single-repo link — honest neutral copy, no error badge.
          var singleRepo = repos.length < 2;
          html += '<p class="meta eco-empty">' +
            (singleRepo
              ? 'Single-repo scan &mdash; run <code>sutra link &lt;client-repo&gt; &lt;server-repo&gt;</code> after scanning both repos to build the cross-app map.'
              : 'No cross-repo edges found yet &mdash; run <code>sutra link &lt;client-repo&gt; &lt;server-repo&gt;</code> after scanning both repos to build the cross-app map.') +
            '</p>';
        } else {
          html +=
            '<label><input type="checkbox" id="eco-unresolved"> Show unresolved links</label>';
        }

        html += "</div>";

        repos.forEach(function (repo) {
          html +=
            '<div class="eco-cluster"><h3>' +
            esc(repo.name) +
            (repo.commit ? " <span class='meta'>@" + esc(repo.commit) + "</span>" : "") +
            "</h3><p class='meta'>Cross-repo endpoints only — heuristic / candidate</p></div>";
        });

        html += '<div class="eco-links"><h3>Cross-repo links</h3>';
        if (edges.length === 0) {
          html += '<p class="meta">No links to display.</p>';
        } else {
          html += "<ul>";
          edges
            .filter(function (e) {
              return showUnresolved || e.resolution !== "unresolved";
            })
            .forEach(function (edge) {
              var cls =
                edge.resolution === "confirmed"
                  ? "link-confirmed"
                  : edge.resolution === "broken"
                    ? "link-broken"
                    : "link-unresolved";
              var src = splitCrossRepoId(edge.from)[0];
              var dst = splitCrossRepoId(edge.to)[0];
              html +=
                '<li class="' +
                cls +
                '"><strong>' +
                esc(edge.method) +
                " " +
                esc(edge.path) +
                "</strong> · " +
                esc(src) +
                " → " +
                esc(dst) +
                " · <span class='badge'>" +
                esc(edge.resolution) +
                "</span></li>";
            });
          html += "</ul>";
        }
        html += "</div></div>";

        root.innerHTML = html;
        document.getElementById("eco-back").onclick = function () {
          root.classList.add("hidden");
          document.getElementById("view-grid").classList.remove("hidden");
        };
        var unresolved = document.getElementById("eco-unresolved");
        if (unresolved) {
          unresolved.checked = showUnresolved;
          unresolved.onchange = function (ev) {
            showUnresolved = ev.target.checked;
            render();
          };
        }
      }

      render();
    },
  };
})();
