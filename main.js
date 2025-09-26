// main.js
window.addEventListener('load', () => {
  const map = window.map;
  if (!map) { console.error('Leaflet map not found'); return; }

  // optional: remove Leaflet's layer control if it exists
  if (window.layersControl?.remove) {
    window.layersControl.remove();
    window.layersControl = null;
  }

  // -- NPRI facilities as WMS (visual points) --
  const NPRI_WMS = 'https://maps-cartes.ec.gc.ca/arcgis/services/STB_DGST/NPRI/MapServer/WMSServer';
  const npriFacilitiesWMS = L.tileLayer.wms(NPRI_WMS, {
    layers: '5',
    format: 'image/png',
    transparent: true,
    opacity: 0.9,
    attribution: 'NPRI © ECCC'
  });

  const toggleWMS = document.getElementById('toggleNPRIwms');
  if (toggleWMS) {
    toggleWMS.addEventListener('change', e => {
      e.target.checked ? npriFacilitiesWMS.addTo(map) : map.removeLayer(npriFacilitiesWMS);
    });
    if (toggleWMS.checked) npriFacilitiesWMS.addTo(map);
  }

  // -- Hover-only labels (vector, invisible markers that catch pointer events) --
  const npriFacilityLabels = L.esri.featureLayer({
    url: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/STB_DGST/NPRI/MapServer/0',
    pane: 'markers', // this pane exists in your inline script
    pointToLayer: (_g, latlng) => L.circleMarker(latlng, {
      radius: 7,        // larger hit target
      weight: 0,
      opacity: 0,
      fillOpacity: 0.001 // must be >0 so it receives mouse events
    }),
    onEachFeature: (f, layer) => {
      const name = f?.properties?.FacilityName || f?.properties?.Facility || 'Facility';
      layer.bindTooltip(name, {
        permanent: false,   // hover only
        sticky: true,
        direction: 'right',
        offset: [6, 0],
        className: 'npri-label'
      });
    }
  });


  // ===== 2018 Census density layer =====
(async function addCensusDensityLayer() {
  const { downloadText } = window;

  // 1) Load data
  let census;
  try {
    census = await window.fetchCensusEAWithDensity();
  } catch (e) {
    console.error(e);
    alert("Failed to load 2018 census layer.");
    return;
  }

  // 2) Build a color scale (quantiles by density)
  const vals = census.features.map(f => f.properties._density).filter(v => isFinite(v));
  vals.sort((a,b)=>a-b);
  function q(p) {
    const i = Math.floor((vals.length-1) * p);
    return vals.length ? vals[i] : 0;
  }
  const breaks = [q(0.1), q(0.3), q(0.5), q(0.7), q(0.9)]; // 10–90th pct
  const colors = ["#edf8fb","#b2e2e2","#66c2a4","#2ca25f","#006d2c","#00441b"]; // light→dark

  function colorFor(v) {
    if (!isFinite(v)) return "#cccccc";
    if (v <= breaks[0]) return colors[0];
    if (v <= breaks[1]) return colors[1];
    if (v <= breaks[2]) return colors[2];
    if (v <= breaks[3]) return colors[3];
    if (v <= breaks[4]) return colors[4];
    return colors[5];
  }

  // 3) Leaflet layer
  const censusLayer = L.geoJSON(census, {
    style: f => ({
      color: "#555",
      weight: 0.6,
      fillColor: colorFor(f.properties._density),
      fillOpacity: 0.65
    }),
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      const html = `
        <div style="min-width:240px">
          <strong>2018 EA</strong>
          <table style="width:100%;font-size:12px">
            <tr><td>Total pop</td><td>${(p._pop_total ?? 0).toLocaleString()}</td></tr>
            <tr><td>Area (km²)</td><td>${(p._area_km2 ?? 0).toFixed(3)}</td></tr>
            <tr><td><strong>Density (ppl/km²)</strong></td><td><strong>${(p._density ?? 0).toFixed(1)}</strong></td></tr>
          </table>
        </div>`;
      layer.bindPopup(html);
    }
  });

  // 4) Add to map + layer control
  censusLayer.addTo(window.map);  // assumes you saved your map as window.map
  if (window.layerControl) {
    window.layerControl.addOverlay(censusLayer, "2018 Census population density");
  }

  // 5) Toggle checkbox
  const toggle = document.getElementById("toggle-census");
  if (toggle) {
    toggle.addEventListener("change", () => {
      if (toggle.checked) censusLayer.addTo(window.map);
      else window.map.removeLayer(censusLayer);
    });
  }

  // 6) Export Top-10 by density (CSV)
  const btn = document.getElementById("btn-export-top10");
  if (btn) {
    btn.addEventListener("click", () => {
      // sort by density desc
      const rows = census.features
        .map(f => f.properties)
        .sort((a,b) => (b._density||0) - (a._density||0))
        .slice(0,10);

      // Conditions summary (edit to reflect your UI filters if any)
      const conditions = {
        dataset: "2018 Municipal Census – Enumeration Areas (Strathcona)",
        metric: "population density (people/km²) = tot_pop / (Shape_Area / 1e6)",
        date_generated: new Date().toISOString(),
        bbox_used: window.CONFIG.censusEA.bbox || "none",
      };

      // Build CSV: include a header block with conditions (as comments)
      const header = [
        "# Conditions used:",
        `# dataset,${conditions.dataset}`,
        `# metric,${conditions.metric}`,
        `# date_generated,${conditions.date_generated}`,
        `# bbox_used,${conditions.bbox_used}`,
        ""
      ].join("\n");

      // Pick a few useful columns (adapt as needed)
      const cols = ["_density","_pop_total","_area_km2","tot_pop","Shape_Area","EA_ID","EA_NAME"];
      // Try to detect an ID/Name field if different
      const safe = (v) => (v===undefined || v===null) ? "" : String(v).replace(/"/g,'""');

      let csv = "rank," + cols.join(",") + "\n";
      rows.forEach((p, i) => {
        const line = [i+1].concat(cols.map(c => safe(p[c]))).join(",");
        csv += line + "\n";
      });

      window.downloadText("top10_density.csv", header + csv);
    });
  }

  // 7) Optional legend
  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    let html = `<div><strong>Population density</strong></div>`;
    const labs = [
      `≤ ${breaks[0].toFixed(0)}`,
      `${breaks[0].toFixed(0)}–${breaks[1].toFixed(0)}`,
      `${breaks[1].toFixed(0)}–${breaks[2].toFixed(0)}`,
      `${breaks[2].toFixed(0)}–${breaks[3].toFixed(0)}`,
      `${breaks[3].toFixed(0)}–${breaks[4].toFixed(0)}`,
      `> ${breaks[4].toFixed(0)}`
    ];
    for (let i=0;i<colors.length;i++) {
      html += `<div><span style="display:inline-block;width:14px;height:14px;background:${colors[i]};border:1px solid #555;margin-right:6px;vertical-align:middle"></span>${labs[i]}</div>`;
    }
    div.innerHTML = html;
    return div;
  };
  legend.addTo(window.map);

})();




  
  const toggleLabels = document.getElementById('toggleNPRILabels');
  const enableLabels = () => {
    if (!map.hasLayer(npriFacilityLabels)) npriFacilityLabels.addTo(map);
    npriFacilityLabels.bringToFront();
  };
  const disableLabels = () => {
    if (map.hasLayer(npriFacilityLabels)) map.removeLayer(npriFacilityLabels);
  };

  if (toggleLabels) {
    toggleLabels.addEventListener('change', e => e.target.checked ? enableLabels() : disableLabels());
    if (toggleLabels.checked) enableLabels();
  } else {
    // no checkbox? just enable by default
    enableLabels();
  }
});
