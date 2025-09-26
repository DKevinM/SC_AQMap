// main.js
window.addEventListener('load', () => {
  const map = window.map;
  if (!map || typeof map.addLayer !== 'function') {
    console.warn('Leaflet map not ready in main.js');
    return;
  }

  // Optional: remove Leaflet's layer control if it exists
  if (window.layersControl?.remove) {
    window.layersControl.remove();
    window.layersControl = null;
  }

  /* ================= NPRI ================= */

  // NPRI facilities as WMS (visual points)
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

  // --- NPRI interactive (hover + click) vector overlay ---
  const npriFacilityInteractive = L.esri.featureLayer({
    url: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/STB_DGST/NPRI/MapServer/0',
    pane: 'markers',        // stays above WMS
    simplifyFactor: 0.2,
    precision: 7,
    pointToLayer: (_g, latlng) => L.circleMarker(latlng, {
      radius: 6,            // bigger hit area for hover
      weight: 0,            // invisible stroke
      opacity: 0,
      fillColor: '#000',
      fillOpacity: 0.001    // nearly invisible but receives mouse events
    }),
    onEachFeature: (f, layer) => {
      const p = f?.properties || {};
      const name = p.FacilityName || p.Facility || 'NPRI facility';
      // Hover tooltip
      layer.bindTooltip(name, {
        permanent: false,
        sticky: true,
        direction: 'right',
        offset: [6, 0],
        className: 'npri-label'
      });
      // Click popup (add/adjust fields as desired)
      const city   = p.City || p.Municipality || '';
      const prov   = p.Province || p.Prov || '';
      const npriId = p.NPRI_ID || p.NPRIId || p.FacilityId || '';
      const naics  = p.NAICS || p.NAICS_Code || '';
      const owner  = p.Owner || p.CompanyName || '';
  
      layer.bindPopup(`
        <div style="min-width:240px">
          <b>${name}</b><br/>
          ${city ? `${city}${prov ? ', '+prov : ''}<br/>` : ''}
          ${owner ? `<div><small>Owner: ${owner}</small></div>` : ''}
          <table style="width:100%;font-size:12px;margin-top:4px">
            ${npriId ? `<tr><td style="color:#666">NPRI ID</td><td>${npriId}</td></tr>` : ''}
            ${naics  ? `<tr><td style="color:#666">NAICS</td><td>${naics}</td></tr>` : ''}
          </table>
          <div style="margin-top:6px;color:#777"><small>Hover for name • Click for details</small></div>
        </div>
      `);
    }
  });
  
  // Keep the vector hover layer synced with the WMS checkbox
  const wmsToggle = document.getElementById('toggleNPRIwms');
  if (wmsToggle) {
    const applyNPRIToggle = () => {
        if (wmsToggle.checked) {
          npriFacilitiesWMS.addTo(map);
          npriFacilityInteractive.addTo(map);
          npriFacilityInteractive.bringToFront?.();
        } else {
          map.removeLayer(npriFacilitiesWMS);
          if (map.hasLayer(npriFacilityInteractive)) map.removeLayer(npriFacilityInteractive);
        }
      };
      // rewire change to also control the interactive layer
      wmsToggle.removeEventListener?.('_npriSync', applyNPRIToggle); // guard if reloaded
      wmsToggle.addEventListener('change', applyNPRIToggle);
      // run once on load
      applyNPRIToggle();
    }

  
  // Single, canonical versions of these helpers (no duplicates!)
  function enableLabels() {
    if (npriFacilityLabels && !map.hasLayer(npriFacilityLabels)) {
      npriFacilityLabels.addTo(map);
    }
    npriFacilityLabels?.bringToFront?.();
  }
  function disableLabels() {
    if (npriFacilityLabels && map.hasLayer(npriFacilityLabels)) {
      map.removeLayer(npriFacilityLabels);
    }
  }

  const toggleLabels = document.getElementById('toggleNPRILabels');
  if (toggleLabels) {
    toggleLabels.addEventListener('change', e => e.target.checked ? enableLabels() : disableLabels());
    if (toggleLabels.checked) enableLabels();
  } else {
    // no checkbox: default on
    enableLabels();
  }

  /* ============== 2018 Census density (OFF by default) ============== */

  const CENSUS_FS_URL =
    'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/2018_Municipal_Census___Enumeration_Areas_Map/FeatureServer/0';

  let censusFL = null;          // FeatureLayer handle (lazy-created)
  let censusBreaks = null;      // quantile breaks for colors
  const censusColors = ['#edf8fb','#b2e2e2','#66c2a4','#2ca25f','#006d2c','#00441b'];

  // --- Helpers: area & density ---

  // Compute area (km²) from feature geometry; fall back to attribute if present
  function areaKm2From(feature) {
    const p = feature.properties || {};
    const m2Attr = Number(p.Shape_Area ?? p.shape_area ?? p.SHAPE__Area ?? p.SHAPE_Area);
    if (Number.isFinite(m2Attr) && m2Attr > 0) return m2Attr / 1e6;

    try {
      const geo = feature.type ? feature : (feature.toGeoJSON ? feature.toGeoJSON() : null);
      if (!geo || !geo.geometry) return 0;
      const m2 = turf.area(geo);  // m²
      return m2 > 0 ? m2 / 1e6 : 0;
    } catch {
      return 0;
    }
  }

  function computeQuantileBreaks(vals){
    if (!vals.length) return null;
    vals.sort((a,b)=>a-b);
    const q = p => vals[Math.floor((vals.length-1)*p)];
    return [q(0.10), q(0.30), q(0.50), q(0.70), q(0.90)];
  }

  function densityFromFeature(feature) {
    const p = feature.properties || {};
    const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
    const km2 = areaKm2From(feature);
    return km2 > 0 ? (tot / km2) : 0;
  }

  function densityFromPropsAndGeom(props, geometry) {
    const tot = Number(props.tot_pop ?? props.TOT_POP ?? 0);
    let km2 = 0;
    const m2Attr = Number(props.Shape_Area ?? props.shape_area ?? props.SHAPE__Area ?? props.SHAPE_Area);
    if (Number.isFinite(m2Attr) && m2Attr > 0) km2 = m2Attr / 1e6;
    else if (geometry) {
      try {
        const m2 = turf.area({ type: 'Feature', properties: {}, geometry });
        km2 = m2 > 0 ? m2 / 1e6 : 0;
      } catch {}
    }
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

  // Query all census features, handling service caps via limit/offset
  async function queryAllCensus(returnGeom = true) {
    const pageSize = 2000;
    let offset = 0;
    const out = { type: 'FeatureCollection', features: [] };

    while (true) {
      const q = L.esri.query({ url: CENSUS_FS_URL })
        .where('1=1')
        .fields(['tot_pop','TOT_POP','Shape_Area','shape_area','EA_ID','EA_NAME'])
        .orderBy('OBJECTID', 'ASC')
        .limit(pageSize)
        .offset(offset)
        .returnGeometry(returnGeom);

      const fc = await new Promise((resolve, reject) =>
        q.run((err, res) => err ? reject(err) : resolve(res))
      );

      const feats = (fc?.features || []);
      out.features.push(...feats);

      if (feats.length < pageSize) break; // last page
      offset += feats.length;
      if (offset > 1_000_000) break;      // safety
    }
    return out;
  }

  // Build quantile breaks + sidebar stats (no map layer needed)
  async function buildCensusBreaksAndStats() {
    const statsDiv = document.getElementById('censusStats');
    try {
      const fc = await queryAllCensus(true); // need geometry for area
      const feats = fc.features.filter(f => f && f.properties && f.geometry);

      const vals = feats
        .map(f => densityFromPropsAndGeom(f.properties, f.geometry))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      const q = p => vals.length ? vals[Math.floor((vals.length - 1) * p)] : 0;
      censusBreaks = [q(0.10), q(0.30), q(0.50), q(0.70), q(0.90)];

      if (statsDiv) {
        const fmt0 = n => Number.isFinite(n) ? n.toFixed(0) : '—';
        statsDiv.innerHTML = `
          <div><b>Features:</b> ${feats.length.toLocaleString()}</div>
          <div><b>Min / Median / Max (people/km²):</b><br>${fmt0(vals[0])} / ${fmt0(q(0.5))} / ${fmt0(vals[vals.length-1])}</div>
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
      }
    } catch (err) {
      console.error(err);
      if (statsDiv) statsDiv.innerHTML = `<span class="err">Failed: ${err.message}</span>`;
    }
  }

  // Create the FeatureLayer (don’t add until toggled on)
  function createCensusFeatureLayer() {
    if (censusFL) return censusFL;

    censusFL = L.esri.featureLayer({
      url: CENSUS_FS_URL,
      pane: 'features',
      where: '1=1',
      simplifyFactor: 0.3,
      precision: 6,
      style: function (feature) {
        const d = densityFromFeature(feature);
        return { color:'#555', weight:0.6, fillColor: colorForDensity(d), fillOpacity:0.65 };
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties || {};
        const km2 = areaKm2From(feature);
        const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
        const d   = km2 > 0 ? (tot / km2) : 0;

        layer.bindPopup(`
          <div style="min-width:240px">
            <strong>2018 Enumeration Area</strong>
            <table style="width:100%;font-size:12px">
              <tr><td>Total population</td><td>${Number.isFinite(tot)?tot.toLocaleString():'0'}</td></tr>
              <tr><td>Area (km²)</td><td>${Number.isFinite(km2)?km2.toFixed(3):'0.000'}</td></tr>
              <tr><td><b>Density (people/km²)</b></td><td><b>${Number.isFinite(d)?d.toFixed(1):'0.0'}</b></td></tr>
            </table>
          </div>
        `);
      }
    });

    return censusFL;
  }

  // Wire up the sidebar controls (start OFF)
  (async function wireCensusUI() {
    const toggle = document.getElementById('toggleCensus');          // unchecked in HTML
    const btn    = document.getElementById('btnExportCensusTop10');
    const stats  = document.getElementById('censusStats');

    try {
      if (stats) stats.textContent = 'Loading stats…';
      await buildCensusBreaksAndStats();
    } catch {
      /* stats already shows error, continue so toggle/export still work */
    }

    toggle?.addEventListener('change', async (e) => {
      if (e.target.checked) {
        const fl = createCensusFeatureLayer();
        fl.addTo(map);
        fl.bringToFront?.();

        // If stats failed (no breaks), build them from the features as they finish loading
        if (!censusBreaks) {
          const statsDiv = document.getElementById('censusStats');
          if (statsDiv) statsDiv.textContent = 'Building legend from loaded features…';

          fl.once('load', () => {
            try {
              const densities = [];
              Object.values(fl._layers || {}).forEach(lyr => {
                const ft = lyr?.feature; if (!ft) return;
                const d = densityFromFeature(ft);
                if (Number.isFinite(d)) densities.push(d);
              });
              const br = computeQuantileBreaks(densities);
              if (br) {
                censusBreaks = br;
                fl.setStyle(feature => {
                  const d = densityFromFeature(feature);
                  return { color:'#555', weight:0.6, fillColor: colorForDensity(d), fillOpacity:0.65 };
                });

                const fmt0 = n => Number.isFinite(n) ? n.toFixed(0) : '—';
                if (statsDiv) {
                  statsDiv.innerHTML = `
                    <div><b>Legend (people/km²)</b></div>
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
                }
              } else if (statsDiv) {
                statsDiv.textContent = 'No features available to build legend.';
              }
            } catch (err) {
              console.error(err);
              const statsDiv = document.getElementById('censusStats');
              if (statsDiv) statsDiv.textContent = 'Legend build failed.';
            }
          });
        }
      } else if (censusFL) {
        map.removeLayer(censusFL);
      }
    });

    // Export Top-10 (uses geometry so area is correct)
    btn?.addEventListener('click', async () => {
      try {
        const fc = await queryAllCensus(true); // geometry for robust area
        const rows = (fc.features || [])
          .map(f => {
            const p = f.properties || {};
            const km2 = areaKm2From(f);
            const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
            const d   = km2 > 0 ? (tot / km2) : 0;
            return { _density:d, _pop_total:tot, _area_km2:km2, ...p };
          })
          .sort((a,b)=> (b._density||0) - (a._density||0))
          .slice(0,10);

        const header = [
          '# Conditions',
          '# dataset, 2018 Municipal Census — Enumeration Areas (Strathcona)',
          '# metric, population density (people/km²) = tot_pop / (area_m² / 1e6)',
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
      } catch (err) {
        console.error(err);
        alert('Export failed: ' + err.message);
      }
    });
  })();

}); // end window.load
