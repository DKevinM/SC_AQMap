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


/* ---------- 2018 Census density via esri-leaflet (OFF by default) ---------- */
const CENSUS_FS_URL =
  'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/2018_Municipal_Census___Enumeration_Areas_Map/FeatureServer/0';

let censusFL = null;          // FeatureLayer handle (we create it lazily)
let censusBreaks = null;      // quantile breaks for legend/colors
const censusColors = ['#edf8fb','#b2e2e2','#66c2a4','#2ca25f','#006d2c','#00441b'];

// Compute density from ArcGIS props
function densityFromProps(p) {
  const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
  const m2  = Number(p.Shape_Area ?? p.shape_area ?? 0);
  const km2 = m2 > 0 ? m2 / 1e6 : 0;
  return km2 > 0 ? (tot / km2) : 0;
}

function colorForDensity(d) {
  if (!censusBreaks) return '#ccc';
  if (d <= censusBreaks[0]) return censusColors[0];
  if (d <= censusBreaks[1]) return censusColors[1];
  if (d <= censusBreaks[2]) return censusColors[2];
  if (d <= censusBreaks[3]) return censusColors[3];
  if (d <= censusBreaks[4]) return censusColors[4];
  return censusColors[5];
}

// Build breaks + sidebar stats once (no map layer needed)
function buildCensusBreaksAndStats() {
  const statsDiv = document.getElementById('censusStats');
  return new Promise((resolve, reject) => {
    L.esri.query({ url: CENSUS_FS_URL })
      .where('1=1')
      .fields(['tot_pop','TOT_POP','Shape_Area','shape_area','EA_ID','EA_NAME'])
      .returnGeometry(false)
      .run((err, fc) => {
        if (err) { statsDiv.innerHTML = `<span class="err">Failed: ${err.message}</span>`; return reject(err); }
        const feats = (fc?.features || []).filter(f => f && f.properties);
        const vals = feats.map(f => densityFromProps(f.properties)).filter(Number.isFinite).sort((a,b)=>a-b);
        const q = p => vals.length ? vals[Math.floor((vals.length-1)*p)] : 0;
        censusBreaks = [q(0.10), q(0.30), q(0.50), q(0.70), q(0.90)];

        // Sidebar stats + legend
        const fmt0 = n => Number.isFinite(n) ? n.toFixed(0) : '—';
        statsDiv.innerHTML = `
          <div><b>Features:</b> ${feats.length.toLocaleString()}</div>
          <div><b>Min / Median / Max (ppl/km²):</b><br>${fmt0(vals[0])} / ${fmt0(q(0.5))} / ${fmt0(vals[vals.length-1])}</div>
          <div style="margin-top:6px"><b>Legend (quantiles)</b></div>
          <div style="display:grid;grid-template-columns:16px 1fr;gap:6px 8px;align-items:center;margin-top:4px">
            ${[0,1,2,3,4,5].map(i=>{
              const lab = [
                `≤ ${fmt0(censusBreaks[0])}`,
                `${fmt0(censusBreaks[0])}–${fmt0(censusBreaks[1])}`,
                `${fmt0(censusBreaks[1])}–${fmt0(censusBreaks[2])}`,
                `${fmt0(censusBreaks[2])}–${fmt0(censusBreaks[3])}`,
                `${fmt0(censusBreaks[3])}–${fmt0(censusBreaks[4])}`,
                `> ${fmt0(censusBreaks[4])}`
              ][i];
              return `<span style="width:16px;height:12px;border:1px solid #555;background:${censusColors[i]}"></span><span>${lab}</span>`;
            }).join('')}
          </div>`;
        resolve();
      });
  });
}

// Create the FeatureLayer (but don't add until toggled on)
function createCensusFeatureLayer() {
  if (censusFL) return censusFL;

  censusFL = L.esri.featureLayer({
    url: CENSUS_FS_URL,
    pane: 'features',
    where: '1=1',
    simplifyFactor: 0.3,
    precision: 6,
    style: function (feature) {
      const d = densityFromProps(feature.properties || {});
      return { color:'#555', weight:0.6, fillColor: colorForDensity(d), fillOpacity:0.65 };
    },
    onEachFeature: function (feature, layer) {
      const p = feature.properties || {};
      const d = densityFromProps(p);
      const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
      const m2  = Number(p.Shape_Area ?? p.shape_area ?? 0);
      const km2 = m2 > 0 ? m2/1e6 : 0;
      layer.bindPopup(`
        <div style="min-width:240px">
          <strong>2018 Enumeration Area</strong>
          <table style="width:100%;font-size:12px">
            <tr><td>Total pop</td><td>${Number.isFinite(tot)?tot.toLocaleString():'0'}</td></tr>
            <tr><td>Area (km²)</td><td>${Number.isFinite(km2)?km2.toFixed(3):'0.000'}</td></tr>
            <tr><td><b>Density (ppl/km²)</b></td><td><b>${Number.isFinite(d)?d.toFixed(1):'0.0'}</b></td></tr>
          </table>
        </div>
      `);
    }
  });

  return censusFL;
}

// Wire up the sidebar controls
(async function wireCensusUI() {
  const toggle = document.getElementById('toggleCensus');          // NOTE: id = toggleCensus
  const btn    = document.getElementById('btnExportCensusTop10');  // NOTE: id = btnExportCensusTop10
  const stats  = document.getElementById('censusStats');

  try {
    stats.textContent = 'Loading stats…';
    await buildCensusBreaksAndStats();
  } catch { /* stats div already shows error */ }

  // Start OFF (checkbox should be unchecked in HTML)
  toggle?.addEventListener('change', (e) => {
    if (e.target.checked) {
      const fl = createCensusFeatureLayer();
      fl.addTo(map);
    } else if (censusFL) {
      map.removeLayer(censusFL);
    }
  });

  // Export Top-10 (query without adding a map layer)
  btn?.addEventListener('click', () => {
    L.esri.query({ url: CENSUS_FS_URL })
      .where('1=1')
      .fields(['tot_pop','TOT_POP','Shape_Area','shape_area','EA_ID','EA_NAME'])
      .returnGeometry(false)
      .run((err, fc) => {
        if (err) { console.error(err); alert('Export failed.'); return; }

        const rows = (fc.features || [])
          .map(f => {
            const p = f.properties || {};
            const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
            const m2  = Number(p.Shape_Area ?? p.shape_area ?? 0);
            const km2 = m2 > 0 ? m2/1e6 : 0;
            const d   = km2 > 0 ? (tot / km2) : 0;
            return { _density:d, _pop_total:tot, _area_km2:km2, ...p };
          })
          .sort((a,b)=> (b._density||0) - (a._density||0))
          .slice(0,10);

        const header = [
          '# Conditions',
          '# dataset, 2018 Municipal Census — Enumeration Areas (Strathcona)',
          '# metric, population density (people/km²) = tot_pop / (Shape_Area / 1e6)',
          `# date_generated, ${new Date().toISOString()}`,
          ''
        ].join('\n');

        const cols = ['_density','_pop_total','_area_km2','tot_pop','Shape_Area','EA_ID','EA_NAME'];
        const safe = v => (v==null ? '' : String(v).replace(/"/g,'""'));
        let csv = 'rank,' + cols.join(',') + '\n';
        rows.forEach((p,i)=> { csv += [i+1].concat(cols.map(c=>safe(p[c]))).join(',') + '\n'; });

        const blob = new Blob([header + csv], { type:'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'top10_census_density.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      });
  });
})();


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
