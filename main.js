/* ------------------------- CONFIG / LAYERS ------------------------- */
const URLS = {
  wifi:  'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/County_Buildings_with_WiFi/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson',
  play:  'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Playgrounds/FeatureServer/3/query?outFields=*&where=1%3D1&f=geojson',
  parks: 'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Parks/FeatureServer/2/query?outFields=*&where=1%3D1&f=geojson',
  fields:'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Playing_Fields/FeatureServer/5/query?outFields=*&where=1%3D1&f=geojson',
  splash:'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Splash_Parks/FeatureServer/8/query?outFields=*&where=1%3D1&f=geojson',
  bldg:  'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Building_Footprints/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson',  // RESTORE
  roads: 'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Street_Network1/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson',     // RESTORE
  pemu:  'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Priority_Environment_Management_Units/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson',
  land: 'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Land_Use_Bylaw/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson'
};
const LAYER_URLS = { purpleair: 'https://raw.githubusercontent.com/DKevinM/AB_datapull/main/data/ACA_PM25_map.json' };

  
  
/* --------------------------- START APP ---------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  /* -------- MAP (create ONCE) -------- */
  const map = L.map('map', { zoomControl:true }).setView([53.53, -113.30], 12);
  window.map = map; // expose the Leaflet map to other scripts
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20}).addTo(map);
  
  // after your tile layer is added
  window.layersControl = L.control.layers(null, null, { collapsed: true }).addTo(map);
  
  // Panes: tiles (200) < features (400) < suitability (410) < markers (420)
  map.createPane('features');    map.getPane('features').style.zIndex = 400;
  map.createPane('suitability'); map.getPane('suitability').style.zIndex = 410;
  map.createPane('markers');     map.getPane('markers').style.zIndex = 420;

  setTimeout(()=>map.invalidateSize(),0);
  window.addEventListener('resize',()=>map.invalidateSize());

  
  // remember last MCDA results so we can export later
  window.lastMCDA = null;

  
  /* -------- UI refs -------- */
  const ui = {
    mode: mode,
    roadsPref: roadsPref,
    cellkm: cellkm, cellkm_val: cellkm_val,
    dmax: dmax, dmax_val: dmax_val,
    w_wifi: w_wifi, w_wifi_val: w_wifi_val,
    w_amen: w_amen, w_amen_val: w_amen_val,
    w_road: w_road, w_road_val: w_road_val,
    w_lu: w_lu, w_lu_val: w_lu_val,
    w_bld: w_bld, w_bld_val: w_bld_val,
    w_pop: w_pop, w_pop_val: w_pop_val,
    excludePEMU: excludePEMU,
    togglePA: togglePA,
    toggleStations: toggleStations,
    toggleHex: toggleHex,
    toggleTop: toggleTop,
    toggleWifi: toggleWifi,
    togglePlay: togglePlay,
    toggleParks: toggleParks,
    toggleFields: toggleFields,
    toggleSplash: toggleSplash,
    toggleRoads: toggleRoads,
    toggleBldg: toggleBldg,
    togglePEMU: togglePEMU,
    toggleLand: toggleLand,
    toggleNPRIwms: toggleNPRIwms,
    industryPref: industryPref,
    w_ind: w_ind, w_ind_val: w_ind_val,
    runBtn: runBtn,
    status: status,
    lu_readout: lu_readout,
    btnClear: btnClear,
  };
  function hookRange(inp, lab){ const f=()=>lab.textContent=(+inp.value).toFixed(inp.step.includes('.')?1:0); inp.addEventListener('input',f); f(); }
  [['cellkm','cellkm_val'],['dmax','dmax_val'],
   ['w_wifi','w_wifi_val'],['w_amen','w_amen_val'],['w_road','w_road_val'],
   ['w_lu','w_lu_val'],['w_bld','w_bld_val'],['w_pop','w_pop_val'],
   ['w_ind','w_ind_val']
  ].forEach(([a,b])=>hookRange(ui[a],ui[b]));

  
  
  /* -------- helpers -------- */
  async function fetchAllArcGISGeoJSON(baseUrl, chunk=2000){
    if (!baseUrl) throw new Error('Missing URL');
    const sep = baseUrl.includes('?') ? '&' : '?';
    let offset = 0, all = [];
    while (true) {
      const url = `${baseUrl}${sep}returnExceededLimitFeatures=true&outSR=4326` +
                  `&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${chunk}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const gj = await res.json();
      const feats = gj.features || [];
      if (!feats.length) break;
      all = all.concat(feats);
      if (feats.length < chunk) break;
      offset += feats.length;
      if (offset > 2_000_000) break; // sanity guard
    }
    return { type:'FeatureCollection', features: all };
  }


  /* ============== 2018 Census density (OFF by default) ============== */

  const CENSUS_FS_URL =
    'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/2018_Municipal_Census___Enumeration_Areas_Map/FeatureServer/0';
  
  let censusFL = null;          // FeatureLayer handle (lazy-created)
  let censusBreaks = null;      // quantile breaks for colors
  const censusColors = ['#edf8fb','#b2e2e2','#66c2a4','#2ca25f','#006d2c','#00441b'];
  
  function areaKm2From(feature) {
    const p = feature.properties || {};
    const m2Attr = Number(p.Shape_Area ?? p.shape_area ?? p.SHAPE__Area ?? p.SHAPE_Area);
    if (Number.isFinite(m2Attr) && m2Attr > 0) return m2Attr / 1e6;
    try { const m2 = turf.area(feature); return m2 > 0 ? m2/1e6 : 0; } catch { return 0; }
  }
  function densityFromFeature(feature) {
    const p = feature.properties || {};
    const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
    const km2 = areaKm2From(feature);
    return km2 > 0 ? (tot / km2) : 0;
  }
  function computeQuantileBreaks(vals){
    if (!vals.length) return null;
    vals.sort((a,b)=>a-b);
    const q = p => vals[Math.floor((vals.length-1)*p)];
    return [q(0.10), q(0.30), q(0.50), q(0.70), q(0.90)];
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
  
  // Paginated fetch used to build legend/stats (no layer needed)
  async function queryAllCensus(returnGeom = true) {
    const pageSize = 2000;
    let offset = 0;
    const out = { type: 'FeatureCollection', features: [] };
  
    while (true) {
      const q = L.esri.query({ url: CENSUS_FS_URL })
        .where('1=1')
        .fields(['*'])                // safest: get all fields
        // .orderBy('OBJECTID','ASC') // remove to avoid 400 on unknown field
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

  
  async function buildCensusBreaksAndStats() {
    const statsDiv = document.getElementById('censusStats');
    try {
      const fc = await queryAllCensus(true); // need geometry for area
      const feats = fc.features.filter(f => f && f.properties && f.geometry);
  
      const vals = feats
        .map(f => densityFromFeature(f))
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
                        const labels = [
                          `≤ ${fmt0(censusBreaks[0])}`,
                          `${fmt0(censusBreaks[0])}–${fmt0(censusBreaks[1])}`,
                          `${fmt0(censusBreaks[1])}–${fmt0(censusBreaks[2])}`,
                          `${fmt0(censusBreaks[2])}–${fmt0(censusBreaks[3])}`,
                          `${fmt0(censusBreaks[3])}–${fmt0(censusBreaks[4])}`,
                          `> ${fmt0(censusBreaks[4])}`
                        ];
                        return `<span style="width:16px;height:12px;border:1px solid #555;background:${censusColors[i]}"></span><span>${labels[i]}</span>`;
                      }).join('')}
                    </div>`;
                }
              } else if (statsDiv) {
                statsDiv.textContent = 'No features available to build legend.';
              }
            } catch (err) {
              console.error(err);
              const statsDiv2 = document.getElementById('censusStats');
              if (statsDiv2) statsDiv2.textContent = 'Legend build failed.';
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



  

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const centroidOrPoint=f=>!f?.geometry?null:(f.geometry.type==='Point'?f:turf.centroid(f));
  function distanceToFeaturesKm(pt, fc){
    if (!fc.features.length) return 999;
    let min = Infinity;
    for (const f of fc.features) { const pf=centroidOrPoint(f); if(!pf) continue;
      const d = turf.distance(pt, pf, {units:'kilometers'}); if (d<min) min=d; }
    return min;
  }
  function distanceToRoadsKm(pt, fc){
    if (!fc.features.length) return 999;
    let min = Infinity;
    for (const f of fc.features) {
      const g=f.geometry; if(!g) continue;
      if (g.type==='LineString'||g.type==='MultiLineString'){
        const d=turf.pointToLineDistance(pt,f,{units:'kilometers'}); if(d<min) min=d;
      } else {
        const d=turf.distance(pt,centroidOrPoint(f),{units:'kilometers'}); if(d<min) min=d;
      }
    }
    return min;
  }
  function pointInAnyPolygon(pt, polysFC){ for (const f of polysFC.features) if (turf.booleanPointInPolygon(pt,f)) return true; return false; }

  function clearResults() {
    if (hexLayer && window.map.hasLayer(hexLayer)) window.map.removeLayer(hexLayer);
    if (topLayer && window.map.hasLayer(topLayer)) window.map.removeLayer(topLayer);
    hexLayer = null;
    topLayer = null;
    ui.status.innerHTML = '<span class="muted">Cleared results.</span>';
  }





    
  // === NPRI (default symbology + HOVER identify) ===
  const NPRI_REST_URL = 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/STB_DGST/NPRI/MapServer';
  const NPRI_LAYERS   = [0];
  
  async function fetchNpriFacilitiesFC() {
    return await new Promise((resolve, reject) => {
      L.esri.query({ url: `${NPRI_REST_URL}/0` })
        .where('1=1')
        .fields(['*'])
        .returnGeometry(true)
        .run((err, fc) => err ? reject(err) : resolve(fc));
    });
  }

  
  let npriDyn = null;              // server-rendered layer (keeps the original legend)
  let npriTip = null;              // Leaflet tooltip for hover
  let npriIdentifyHandler = null;  // mousemove handler
  
  function startNpriHover() {
    const map = window.map;
    if (!map) return;
  
    if (!npriDyn) {
      npriDyn = L.esri.dynamicMapLayer({
        url: NPRI_REST_URL,
        layers: NPRI_LAYERS,
        opacity: 1
      }).addTo(map);
    }
  
    if (!npriTip) {
      npriTip = L.tooltip({
        sticky: true,
        direction: 'top',
        offset: [0, -6],
        className: 'npri-label'
      });
    }
  
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  
    let tId = null;
    npriIdentifyHandler = (e) => {
      if (tId) clearTimeout(tId);
      tId = setTimeout(() => {
        L.esri.identifyFeatures({ url: NPRI_REST_URL })
          .on(map)
          .at(e.latlng)
          .layers('visible:' + NPRI_LAYERS.join(','))
          .tolerance(8)
          .returnGeometry(false)
          .run((err, fc) => {
            if (err) { if (npriTip?._map) map.removeLayer(npriTip); return; }
            const f = fc?.features?.[0];
            if (!f) { if (npriTip?._map) map.removeLayer(npriTip); return; }
          
            const p = f.properties || {};
          
            // helper to pick a field by regex pattern (case-insensitive)
            const get = (obj, patterns) => {
              const keys = Object.keys(obj || {});
              for (const pat of patterns) {
                const re = new RegExp(pat, 'i');
                const k = keys.find(key => re.test(key));
                if (k) return obj[k];
              }
              return '';
            };
          
            const reportingYr = get(p, ['^report', 'reporting.?year', '\\byear\\b']);
            const npriId      = get(p, ['^npri', 'npri.?id', 'npri.?number']);
            const company     = get(p, ['company', 'owner', 'operator']);
            const facility    = get(p, ['facility', '^name$']);
            const sector      = get(p, ['sector']);
          
            let html = '';
            if (reportingYr) html += `<div><b>Reporting year:</b> ${esc(reportingYr)}</div>`;
            if (npriId)      html += `<div><b>NPRI ID:</b> ${esc(npriId)}</div>`;
            if (company)     html += `<div><b>Company:</b> ${esc(company)}</div>`;
            if (facility)    html += `<div><b>Facility:</b> ${esc(facility)}</div>`;
            if (sector)      html += `<div><b>Sector:</b> ${esc(sector)}</div>`;
          
            npriTip.setContent(html || '<b>NPRI Facility</b>');
            npriTip.setLatLng(e.latlng);
            if (!npriTip._map) npriTip.addTo(map);
          }); 
      }, 120);
    };
  
    map.on('mousemove', npriIdentifyHandler);
  }
  
  function stopNpriHover() {
    const map = window.map;
    if (map && npriIdentifyHandler) map.off('mousemove', npriIdentifyHandler);
    npriIdentifyHandler = null;
    if (npriTip && npriTip._map) map.removeLayer(npriTip);
    npriTip = null;
    if (npriDyn && map) { map.removeLayer(npriDyn); npriDyn = null; }
  }
  
  // single checkbox wiring (HTML id="toggleNPRIwms")
  document.getElementById('toggleNPRIwms')?.addEventListener('change', (e) => {
    if (e.target.checked) startNpriHover();
    else stopNpriHover();
  });


  
    // hover; switch to 'click' if you prefer quieter identify
    map.on('mousemove', npriIdentifyHandler);
  
  
  function stopNpri() {
    const map = window.map;
    if (npriIdentifyHandler && map) map.off('mousemove', npriIdentifyHandler);
    npriIdentifyHandler = null;
    if (npriTip && npriTip._map) map.removeLayer(npriTip);
    npriTip = null;
    if (npriDyn && map) { map.removeLayer(npriDyn); npriDyn = null; }
  }
  
  // Wire the checkbox
  document.getElementById('toggleNPRIwms')?.addEventListener('change', (e) => {
    if (e.target.checked) startNpri();
    else stopNpri();
  });


  


  // ---------- 1) CODE MAPPING BY ZONING ----------
  const ZONING_BUCKETS = {
    Industrial: new Set(['IH','IHH','IL','ILT','IM','IMH']),
    Commercial: new Set(['A','C1','C2','C3','C4','C5','C6','C7','CITP','DC1']),
    Institutional: new Set(['MI','MU1','MU2','PS','PU']),
    Residential: new Set([
      'ALD','HR1','HR2','HR4','R1A','R1B','R1C','R1D','R1E','R2A','R2B','R2C',
      'R3','R4','R5','R6','R7','RCH','RCL','RCS','RE','RH','RLD1','RM','RS','RSO','SRR1','UV3'
    ]),
    'Park/Open Space': new Set(['PC','PG','PR','PRM']),
    Agriculture: new Set(['AD','AG','AR','RA']),
  };
  
  // Scores for each bucket
  // ====== CONFIG: 6 buckets → score ======
  const BUCKET_SCORE = {
    'Industrial': 0.90,
    'Commercial': 0.80,
    'Institutional': 0.75,
    'Residential': 0.60,
    'Park/Open Space': 0.40,
    'Agriculture': 0.50
  };
  
  // ====== NORMALIZERS ======
  function norm(s){ return (s==null?'':String(s)).normalize('NFKC').trim(); }
  function upper(s){ return norm(s).toUpperCase(); }
  
  // Normalize zoning like: CITP "Area BC" → CITP ; DC71 "A" → DC71 ; AG (stuff) → AG
  function normalizeZone(z){
    const u = upper(z);
    const m = u.match(/[A-Z0-9]+/); // first token
    return m ? m[0] : u;
  }
  
  // Normalize description like: "CITP - Centre in the Park" → "CITP - CENTRE IN THE PARK"
  function normalizeDesc(d){
    let u = upper(d);
    // collapse weird dashes/whitespace
    u = u.replace(/\s*[-–—]\s*/g, ' - ').replace(/\s+/g, ' ').trim();
    return u;
  }



  // Map a feature's props to our bucket + score using description first, then zoning code
  function landUseScoreAndLabel(props){
    const zRaw = props.lub_zoning ?? props.ZONE ?? props.DISTRICT ?? props.Zoning ?? '';
    const dRaw = props.lub_description ?? props.LAND_USE ?? props.LANDUSE ?? '';
    const zone = normalizeZone(zRaw);
    const desc = normalizeDesc(dRaw);
  
    // 1) description-first classification
    let bucket = classifyByDescription(desc);
  
    // 2) fallback to zoning code if still unknown
    if (!bucket && zone) {
      for (const [b, set] of Object.entries(ZONING_BUCKETS)) {
        if (set.has(zone)) { bucket = b; break; }
      }
    }
  
    // 3) neutral if still unknown
    if (!bucket) return { score: 0.50, label: 'Unclassified', source: { zone: zRaw, desc: dRaw } };
  
    return { score: BUCKET_SCORE[bucket], label: bucket, source: { zone: zRaw, desc: dRaw } };
  }
  
  // Look up land-use at a point: exact polygon hit else nearest polygon
  function landUseAtPointWithDetails(pt, polysFC){
    for (const f of (polysFC.features || [])) {
      try { if (turf.booleanPointInPolygon(pt, f)) return landUseScoreAndLabel(f.properties || {}); }
      catch {}
    }
    if (!(polysFC.features || []).length) return { score: 0.50, label: '(no polygons)' };
    let best=null, bestD=Infinity;
    for (const f of polysFC.features) {
      try {
        const d = turf.distance(pt, turf.centroid(f), { units:'kilometers' });
        if (d < bestD) { bestD = d; best = landUseScoreAndLabel(f.properties || {}); }
      } catch {}
    }
    return best || { score: 0.50, label: 'Unclassified' };
  }



  
  // ====== DESCRIPTION-FIRST CLASSIFIER ======
  function classifyByDescription(descRaw){
    const d = normalizeDesc(descRaw);
  
    // --- exact descriptions (fast path) ---
    // Airport
    if (d === 'A - AIRPORT') return 'Institutional';
  
    // Agriculture family
    if (d.startsWith('AD - AGRICULTURE') || d.startsWith('AG - AGRICULTURE') ||
        d.startsWith('AR - AGRICULTURE') || d.includes('RURAL RESIDENTIAL/AGRICULTURE')) {
      return 'Agriculture';
    }
  
    // Park/Open Space family
    if (d.startsWith('PC -') || d.startsWith('PG -') ||
        d.startsWith('PR -') || d.startsWith('PRM -')) {
      return 'Park/Open Space';
    }
  
    // Industrial family
    if (d.startsWith('IH -') || d.startsWith('IHH -') ||
        d.startsWith('IL -') || d.startsWith('ILT -') ||
        d.startsWith('IM -') || d.startsWith('IMH -')) {
      return 'Industrial';
    }
  
    // Commercial family (C1..C7, CITP - Centre in the Park)
    if (d.startsWith('C1 -') || d.startsWith('C2 -') || d.startsWith('C3 -') ||
        d.startsWith('C4 -') || d.startsWith('C5 -') || d.startsWith('C6 -') ||
        d.startsWith('C7 -') || d.includes('CITP - CENTRE IN THE PARK')) {
      return 'Commercial';
    }
  
    // Institutional family
    if (d.startsWith('MI -') || d.startsWith('MU1 -') || d.startsWith('MU2 -') ||
        d.startsWith('PS -') || d.startsWith('PU -')) {
      return 'Institutional';
    }
  
    // Residential family
    if (/^(ALD|HR1|HR2|HR4|R1A|R1B|R1C|R1D|R1E|R2A|R2B|R2C|R3|R4|R5|R6|R7|RCH|RCL|RCS|RE|RH|RLD1|RM|RS|RSO|SRR1|UV2|UV3|UV4)\b/.test(d)) {
      return 'Residential';
    }
  
    // --- keyword heuristics (if the exact startsWith didn’t trigger) ---
    if (/AGRIC|FARM|RURAL/.test(d)) return 'Agriculture';
    if (/PARK|OPEN SPACE|RECREATION|TRAIL|NATURAL AREA|CONSERV/.test(d)) return 'Park/Open Space';
    if (/INDUSTRIAL|WAREHOUSE|LOGISTICS|PROCESSING|PLANT|BUSINESS PARK/.test(d)) return 'Industrial';
    if (/COMMERCIAL|RETAIL|SHOPPING|OFFICE|SERVICE COMMERCIAL|DOWNTOWN COMMERCIAL/.test(d)) return 'Commercial';
    if (/INSTITUTION|SCHOOL|HOSPITAL|HEALTH|MUNICIPAL|GOVERNMENT|FIRE HALL|POLICE|LIBRARY|CEMETERY/.test(d)) return 'Institutional';
    if (/RESIDENTIAL|APARTMENT|MULTI[- ]FAMILY|SINGLE[- ]DETACHED|TOWN(HOUSE)?|ROW(HOUSE)?|MOBILE HOME|URBAN VILLAGE/.test(d)) return 'Residential';
  
    // --- Direct Control nuance: try to infer from trailing words ---
    if (d.includes('DC - DIRECT CONTROL')) {
      if (/RESIDENTIAL|URBAN VILLAGE/.test(d)) return 'Residential';
      if (/COMMERCIAL|RETAIL|OFFICE/.test(d)) return 'Commercial';
      if (/INDUSTRIAL/.test(d)) return 'Industrial';
      if (/PARK|OPEN SPACE|RECREATION/.test(d)) return 'Park/Open Space';
      if (/AGRIC/.test(d)) return 'Agriculture';
      if (/INSTITUTION|SCHOOL|HOSPITAL|GOVERNMENT/.test(d)) return 'Institutional';
      return null; // unknown DC → let code try; else neutral
    }
  
    return null; // let code fallback try
  }
  
 

  /* -------- state -------- */
  let LAYERS = {};
  let appReady = false;
  let hexLayer=null, topLayer=null;
  let paLayer=null, stnLayer=null;
  let npriFacilitiesWMS = null;
  const colorForAQHI = a => (isNaN(+a)?'#666':(+a<=3?'#2ca25f':+a<=6?'#ffb000':+a<=10?'#d73027':'#7a1fa2'));

  async function buildStationsLayer() {
    try {
      await window.dataReady;
      const rows = await window.fetchAllStationData();
      if (!rows?.length) return L.layerGroup();
      return L.layerGroup(rows.map(r => L.circleMarker([+r.lat,+r.lon],{
        radius:5, weight:2, color:'#333', fillColor:colorForAQHI(r.aqhi), fillOpacity:1
      }).bindPopup(r.html).bindTooltip(`${r.stationName} — AQHI: ${r.aqhi}`,{direction:'top',offset:[0,-8]})));
    } catch (e) { console.error(e); return L.layerGroup(); }
  }

  async function buildExternalPointsLayer(url, style={}){
    try {
      const res=await fetch(url); if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json=await res.json();
      const fc = json?.type==='FeatureCollection'?json:
                 Array.isArray(json)?arrayToFeatureCollection(json):
                 json?.data?arrayToFeatureCollection(json.data):
                 json?.features?{type:'FeatureCollection',features:json.features}:
                 arrayToFeatureCollection(Object.values(json));
      return L.geoJSON(fc, {
        pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4,weight:1.5,color:style.color||'#333',fillColor:'#fff',fillOpacity:1})
          .bindTooltip(f.properties?.name||f.properties?.label||style.label||'',{direction:'top',offset:[0,-6]})
      });
    } catch(e){ console.error('External layer failed',e); return null; }
  }
  function arrayToFeatureCollection(arr){
    const latK=['lat','latitude','Latitude','LAT','Lat'].find(k=>k in (arr[0]||{}));
    const lonK=['lon','lng','long','longitude','Longitude','LON','Lng'].find(k=>k in (arr[0]||{}));
    return { type:'FeatureCollection', features: (arr||[]).map(r=>({
      type:'Feature', properties:{...r}, geometry:{type:'Point',coordinates:[+r[lonK],+r[latK]]}
    })).filter(f=>isFinite(f.geometry.coordinates[0])&&isFinite(f.geometry.coordinates[1])) };
  }

  async function queryAllLandUse() {
    const url = 'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Land_Use_Bylaw/FeatureServer/0';
    return await new Promise((resolve, reject) => {
      L.esri.query({ url })
        .where('1=1')
        .fields(['*'])
        .returnGeometry(true)
        .run((err, fc) => err ? reject(err) : resolve(fc));
    });
  }

    // for MCDA use across functions
  let CENSUS_FC = null;
  let CENSUS_MIN = 0, CENSUS_MAX = 1;


  async function probeArcgisCount(url){
    const u = new URL(url);
    // normalize to count endpoint
    u.searchParams.set('where', '1=1');
    u.searchParams.set('returnCountOnly', 'true');
    u.searchParams.set('f', 'json');
    u.searchParams.delete('outFields');
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error(`probe HTTP ${res.status}`);
    const j = await res.json();
    return Number(j.count || 0);
  }
  
  // Try the given URL first; if count=0, try layer ids 0..9;
  // if still 0, flip FeatureServer<->MapServer and try 0..9 again.
  // Returns a proper GeoJSON FeatureCollection and logs the URL it used.
  async function fetchArcgisGeoJSONSmart(url){
    try {
      const tryOne = async (u) => {
        const c = await probeArcgisCount(u).catch(()=>0);
        console.log('[wifi] probe', u, '→ count=', c);
        return c > 0 ? await fetchAllArcGISGeoJSON(u) : null;
      };
  
      // 1) As-is
      let fc = await tryOne(url);
      if (fc) { console.log('[wifi] ✓ using provided URL'); return fc; }
  
      // Helper: rewrite layer id in "/FeatureServer/<id>/query"
      const m = url.match(/(\/(FeatureServer|MapServer)\/)(\d+)(\/query.*)$/i);
      const base = m ? url.replace(/(\/(FeatureServer|MapServer)\/)(\d+)(\/query.*)$/i, '$1') : null;
      const tail = m ? url.replace(/.*\/(FeatureServer|MapServer)\/\d+(\/query.*)$/i, '$2') : null;
      const srv  = m ? m[2] : null;
  
      // 2) Same server type, scan layer ids 0..9
      if (base && tail) {
        for (let i=0; i<10; i++) {
          const u = `${base}${i}${tail}`;
          fc = await tryOne(u);
          if (fc) { console.log('[wifi] ✓ resolved to layer', i); return fc; }
        }
      }
  
      // 3) Flip FeatureServer <-> MapServer and try again
      if (srv && base && tail) {
        const flipped = srv.toLowerCase()==='featureserver' ? 'MapServer' : 'FeatureServer';
        const base2 = base.replace(/\/(FeatureServer|MapServer)\/$/i, `/${flipped}/`);
        for (let i=0; i<10; i++) {
          const u = `${base2}${i}${tail}`;
          fc = await tryOne(u);
          if (fc) { console.log('[wifi] ✓ resolved to', flipped, 'layer', i); return fc; }
        }
      }
  
      console.warn('[wifi] all probes returned 0 — leaving empty FC');
      return { type:'FeatureCollection', features:[] };
    } catch (e) {
      console.error('[wifi] smart fetch failed', e);
      return { type:'FeatureCollection', features:[] };
    }
  }




  
  /* -------- init: fetch data for MCDA + build overlays -------- */
  async function init(){
    try {
      ui.status.textContent='Loading live layers…';
        const [wifi,play,parks,fields,splash,bldg,roads,pemu,landAll] = await Promise.all([
          fetchArcgisGeoJSONSmart(URLS.wifi),
          fetchAllArcGISGeoJSON(URLS.play),
          fetchAllArcGISGeoJSON(URLS.parks),
          fetchAllArcGISGeoJSON(URLS.fields),
          fetchAllArcGISGeoJSON(URLS.splash),
          fetchAllArcGISGeoJSON(URLS.bldg),
          fetchAllArcGISGeoJSON(URLS.roads),
          fetchAllArcGISGeoJSON(URLS.pemu),
          fetchAllArcGISGeoJSON(URLS.land)   
        ]);

      
      console.log('[wifi] features:', wifi?.features?.length || 0, 'geom:', wifi?.features?.[0]?.geometry?.type);
      if (!wifi?.features?.length) {
        console.warn('[wifi] 0 features returned from URLS.wifi — check the service or query');
      }

      
      const npri = await fetchNpriFacilitiesFC();


      const amenities = {
        type:'FeatureCollection',
        features:[]
          .concat(play.features)
          .concat(parks.features.map(f=>turf.centroid(f)))
          .concat(fields.features.map(f=>turf.centroid(f)))
          .concat(splash.features)
      };
      const bldgCentroids = { type:'FeatureCollection', features:bldg.features.map(f=>turf.centroid(f)) };

      LAYERS = { wifi, play, parks, fields, splash, amenities,
                 bldgPolys: bldg, bldgCentroids, roads, pemu, land: landAll,
                 npri };



      // Display overlays (constant widths)
      const wifiDisp = (() => {
        if (!wifi || !wifi.features?.length) return L.layerGroup(); // nothing to show; toggle won’t explode
      
        // If the layer is points: draw circles. If polygons: draw filled outlines.
        const firstType = wifi.features[0]?.geometry?.type || '';
        const isPointy = firstType === 'Point' || firstType === 'MultiPoint';
      
        if (isPointy) {
          return L.geoJSON(wifi, {
            pane: 'markers',
            pointToLayer: (f, ll) => L.circleMarker(ll, {
              radius: 5,
              weight: 1.5,
              color: '#016797',
              fillColor: '#35a7ff',
              fillOpacity: 0.9
            }).bindTooltip(
              f.properties?.LOCATION || f.properties?.NAME || f.properties?.Building || 'Wi-Fi',
              { direction: 'top', offset: [0, -6] }
            )
          });
        } else {
          return L.geoJSON(wifi, {
            pane: 'features',
            style: () => ({
              color: '#016797',
              weight: 1,
              fillColor: '#35a7ff',
              fillOpacity: 0.25
            }),
            onEachFeature: (f, lyr) => {
              const p = f.properties || {};
              const label = p.LOCATION || p.NAME || p.Building || 'Wi-Fi';
              lyr.bindTooltip(label, { direction: 'top', offset: [0, -6] });
            }
          });
        }
      })();
      const playDisp  = L.geoJSON(play,  { pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4,weight:1,color:'#0099cb',fillOpacity:0.9}) });
      const parksDisp = L.geoJSON(parks, { style:()=>({color:'#2e7d32',weight:1,fillColor:'#a5d6a7',fillOpacity:0.25}) });
      const fieldsDisp= L.geoJSON(fields,{ style:()=>({color:'#1b5e20',weight:1,fillColor:'#c8e6c9',fillOpacity:0.25}) });
      const splashDisp= L.geoJSON(splash,{ pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4,weight:1,color:'#0aa2ff',fillOpacity:0.9}) });
      const pemuDisp = L.geoJSON(pemu, {
        style: () => ({
          color: '#6a0080',
          weight: 1.2,
          fillColor: '#dcb6ef',
          fillOpacity: 0.25
        }),
        onEachFeature: (f, lyr) => {
          const p = f.properties || {};
          // Try a few likely field names; fall back to a generic label
          const name = p.NAME || p.Name || p.PEMU_NAME || 'Priority Env. Mgmt Unit';
          const cat  = p.CATEGORY || p.Category || p.TYPE || p.Type || '';
          const tip  = `${name}${cat ? ' — ' + cat : ''}${ui.excludePEMU.checked ? ' (excluded)' : ''}`;
      
          // Hover tooltip (no click needed)
          lyr.bindTooltip(tip, {
            sticky: true,
            direction: 'top',
            offset: [0, -6],
            className: 'npri-label'
          });
      
          // Optional: keep a click popup with more details
          lyr.bindPopup(`
            <div style="min-width:220px">
              <b>${name}</b><br/>
              ${cat ? `<div>Type: ${cat}</div>` : ''}
              <div>${ui.excludePEMU.checked ? '<span class="err">Currently excluded in scoring</span>' : 'Visible only (not excluded)'}</div>
            </div>
          `);
      
          // Highlight on hover
          lyr.on('mouseover', () => {
            lyr.setStyle({ weight: 2, color: '#4a0060', fillOpacity: 0.35 });
            lyr.bringToFront?.();
          });
          lyr.on('mouseout', () => pemuDisp.resetStyle(lyr));
        }
      });

      
      // Streamed land-use display layer (reliable, loads by extent)
      const landFL = L.esri.featureLayer({
        url: 'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Land_Use_Bylaw/FeatureServer/0',
        pane: 'features',
        simplifyFactor: 0.2,
        precision: 7,
        style: f => {
          const det = landUseScoreAndLabel(f.properties || {});
          const t = (det.score - 0.4) / (0.9 - 0.4);
          return { color:'#666', weight:0.5, fillColor:`hsl(${210-160*Math.max(0,Math.min(1,t))},60%,70%)`, fillOpacity:0.35 };
        },
        onEachFeature: (f, lyr) => {
          const p = f.properties || {};
          const det = landUseScoreAndLabel(p);
          const zone = p.lub_zoning ?? '';
          const desc = p.lub_description ?? '';
          const tip = (desc || zone || 'Land-use') + ` — ${det.label} (${det.score.toFixed(2)})`;
          lyr.bindTooltip(tip, { sticky:true, direction:'top', offset:[0,-6], className:'npri-label' });
          lyr.on('mouseover', () => { lyr.setStyle({ weight:1.2, color:'#333', fillOpacity:0.45 }); lyr.bringToFront?.(); });
          lyr.on('mouseout',  () => landFL.resetStyle(lyr));
        }
      });

      
      L.esri.query({ url: 'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Land_Use_Bylaw/FeatureServer/0' })
        .bounds((err, bounds) => { if (!err && bounds) map.fitBounds(bounds.pad(0.02)); });





      // Pull EAs once for MCDA, with geometry (paginate to be safe)
      async function queryAllCensus(returnGeom = true) {
        const base = 'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/2018_Municipal_Census___Enumeration_Areas_Map/FeatureServer/0/query';
        const fields = ['tot_pop','TOT_POP','Shape_Area','shape_area','EA_ID'].join(',');
        const chunk = 2000;
        let offset = 0;
        const out = { type:'FeatureCollection', features:[] };
        while (true) {
          const url = `${base}?where=1=1&outFields=${encodeURIComponent(fields)}&f=geojson` +
                      `&returnExceededLimitFeatures=true&outSR=4326` +
                      `&resultOffset=${offset}&resultRecordCount=${chunk}` +
                      `&returnGeometry=${returnGeom ? 'true' : 'false'}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Census HTTP ${res.status} at offset ${offset}`);
          const gj = await res.json();
          const feats = gj.features || [];
          out.features.push(...feats);
          if (feats.length < chunk) break;
          offset += feats.length;
        }
        return out;
      }

      
      try {
        const fc = await queryAllCensus(true);
        // compute density per feature & keep a tight FC for point lookups
        const feats = (fc.features||[]).filter(f=>f && f.geometry && f.properties);
        const densVals = [];
        feats.forEach(f=>{
          const p=f.properties;
          const tot = Number(p.tot_pop ?? p.TOT_POP ?? 0);
          const km2 = (function(){
            const m2Attr = Number(p.Shape_Area ?? p.shape_area ?? p.SHAPE__Area ?? p.SHAPE_Area);
            if (Number.isFinite(m2Attr) && m2Attr>0) return m2Attr/1e6;
            try { const m2=turf.area(f); return m2>0?m2/1e6:0; } catch { return 0; }
          })();
          const d = km2>0 ? (tot/km2) : 0;
          p._density = d;
          if (Number.isFinite(d)) densVals.push(d);
        });
        if (densVals.length) {
          CENSUS_MIN = Math.min(...densVals);
          CENSUS_MAX = Math.max(...densVals);
        }
        CENSUS_FC = { type:'FeatureCollection', features: feats };
      } catch(e) {
        console.warn('Census FC for MCDA failed; pop-density weight will act as neutral.', e);
      }


      
      // Streaming Esri overlays (constant style)
      const roadsFL = L.esri.featureLayer({
        url:'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Street_Network1/FeatureServer/0',
        pane:'features', style:{color:'#a16d00',weight:1,opacity:0.9}, simplifyFactor:0.1, precision:7
      });
      const bldgFL  = L.esri.featureLayer({
        url:'https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/Building_Footprints/FeatureServer/0',
        pane:'features', style:{color:'#444',weight:0.7,fillColor:'#bdbdbd',fillOpacity:0.35}, simplifyFactor:0.1, precision:7
      });

      // checkbox ↔ layer wiring
      function bindToggle(el, layer){ if(!el) return;
        if (el.checked) { layer.addTo(map); layer.bringToFront?.(); }
        el.addEventListener('change', e => e.target.checked ? layer.addTo(map).bringToFront?.() : map.removeLayer(layer));
      }
      bindToggle(ui.toggleWifi,   wifiDisp);
      bindToggle(ui.togglePlay,   playDisp);
      bindToggle(ui.toggleParks,  parksDisp);
      bindToggle(ui.toggleFields, fieldsDisp);
      bindToggle(ui.toggleSplash, splashDisp);
      bindToggle(ui.togglePEMU,   pemuDisp);
      bindToggle(ui.toggleLand,   landFL);
      bindToggle(ui.toggleRoads,  roadsFL);
      bindToggle(ui.toggleBldg,   bldgFL);

      ui.status.textContent = 'Ready. Click Recompute.';
      appReady = true;
      
    } catch(e){
      console.error(e);
      ui.status.innerHTML = `<span class="err">Failed to load data: ${e.message}</span>`;
    }
    
  }

  function popDensityAtPoint(pt, censusFC){
    if (!censusFC || !censusFC.features?.length) return null;
    for (const f of censusFC.features) {
      try { if (turf.booleanPointInPolygon(pt, f)) return Number(f.properties?._density) || 0; }
      catch {}
    }
    return null; // if not found, treat as neutral later
  }
  
  /* --------------------------- SCORING ------------------------------ */
  function recompute(){
    if (!appReady) { ui.status.innerHTML = '<span class="warn">Still loading…</span>'; return; }
    if (!LAYERS.land) { ui.status.innerHTML='<span class="warn">Data not loaded yet…</span>'; return; }
    ui.status.innerHTML='<span class="muted">Computing…</span>';

    const cellKm = +ui.cellkm.value, dMax = +ui.dmax.value;
    const mode = ui.mode.value,
          roadsPref = ui.roadsPref.value,
          industryPref = ui.industryPref.value,
          excludePEMU = ui.excludePEMU.checked;


    let w = {
      wifi:+ui.w_wifi.value, amen:+ui.w_amen.value, road:+ui.w_road.value,
      lu:+ui.w_lu.value, bld:+ui.w_bld.value, pop:+ui.w_pop.value,
      ind:+ui.w_ind.value
    };

    const s = Object.values(w).reduce((a,b)=>a+b,0)||1;
    Object.keys(w).forEach(k=>w[k]=w[k]/s);


    const { wifi, amenities, bldgCentroids, roads, pemu, land, npri } = LAYERS;
    const bbox = turf.bbox(land);
    const hex = turf.hexGrid(bbox, cellKm, { units:'kilometers' });

    const raw = []; let maxBldDen=0;
    for (const cell of hex.features){
      const center = turf.centerOfMass(cell);
      const dWifi = distanceToFeaturesKm(center, wifi);
      const dAmen = distanceToFeaturesKm(center, amenities);
      const dRoad = distanceToRoadsKm(center, roads);
      const dInd  = distanceToFeaturesKm(center, npri || { type:'FeatureCollection', features:[] });
      const ring = turf.circle(center, 0.1, {steps:16, units:'kilometers'});
      const dens = turf.pointsWithinPolygon(bldgCentroids, ring).features.length; if (dens>maxBldDen) maxBldDen=dens;
      const luDet = landUseAtPointWithDetails(center, land);
      const pd = popDensityAtPoint(center, CENSUS_FC); // may be null if outside or census missing
      const allowed = excludePEMU && pointInAnyPolygon(center, pemu) ? 0 : 1;
      raw.push({
        cell, center, dWifi, dAmen, dRoad, dInd, dens,
        luScore: luDet.score, luLabel: luDet.label, pd, allowed
      });
    }

    const denMax = Math.max(1, maxBldDen);
    for (const r of raw) {
      const s_wifi = clamp(1 - (r.dWifi / dMax), 0, 1);
      const s_amen = (mode === 'exposure') ? clamp(1 - (r.dAmen / dMax), 0, 1)
                                           : clamp((r.dAmen / dMax), 0, 1);
      const s_road = (roadsPref === 'closer') ? clamp(1 - (r.dRoad / dMax), 0, 1)
                                              : clamp((r.dRoad / dMax), 0, 1);
      const s_ind  = (industryPref === 'closer') ? clamp(1 - (r.dInd / dMax), 0, 1)
                                              : clamp((r.dInd / dMax), 0, 1);
      const s_bld  = clamp(r.dens / denMax, 0, 1);
      const s_lu   = clamp(r.luScore, 0, 1);
      
    
      let s_pop;
      if (r.pd == null || !isFinite(r.pd) || CENSUS_MAX <= CENSUS_MIN) {
        s_pop = 0.5;
      } else {
        const t = (r.pd - CENSUS_MIN) / (CENSUS_MAX - CENSUS_MIN);
        s_pop = (mode === 'exposure') ? t : (1 - t);
      }
    
      r.components = { s_wifi, s_amen, s_road, s_bld, s_lu, s_pop, s_ind };
      r.inputs = {
        dWifi_km: r.dWifi,
        dAmen_km: r.dAmen,
        dRoad_km: r.dRoad,
        dInd_km:  r.dInd, 
        bldgCount100m: r.dens,
        landUseLabel: r.luLabel,
        landUseScore: r.luScore,
        popDensity: (r.pd ?? null)
      };
    
      r.scoreRaw = w.wifi*s_wifi + w.amen*s_amen + w.road*s_road +
                   w.lu*s_lu + w.bld*s_bld + w.pop*s_pop +
                   w.ind*s_ind;
      r.score = r.scoreRaw * r.allowed;
    }


    
    const minS = Math.min(...raw.map(r=>r.score)), maxS = Math.max(...raw.map(r=>r.score));
    const colorFor=s=>{ const t=(s-minS)/(maxS-minS+1e-9); return `hsl(${200-160*t}, ${30+40*t}%, ${85-45*t}%)`; };

    hex.features.forEach((f,i)=>{ const r=raw[i];
      f.properties = {
        score:+r.score.toFixed(3),
        lu_score:+r.luScore.toFixed(2),
        lu_label:r.luLabel,
        d_ind_km:+r.dInd.toFixed(3) // optional
      };
    });

    if (hexLayer) map.removeLayer(hexLayer);
    hexLayer = L.geoJSON(hex, {
      pane:'suitability',
      style:f=>({color:'#aaa',weight:0.4,fillColor:colorFor(f.properties.score),fillOpacity:0.78})
    }).addTo(map);
    if (ui.toggleHex && !ui.toggleHex.checked) map.removeLayer(hexLayer);

    const top10 = raw.filter(r=>r.allowed===1).sort((a,b)=>b.score-a.score).slice(0,10);
    const topFC = { type:'FeatureCollection', features: top10.map(r=>({type:'Feature',properties:{score:+r.score.toFixed(3)},geometry:r.center.geometry})) };
    // Save a snapshot for export
    window.lastMCDA = {
      when: new Date().toISOString(),
      params: {
        mode,
        roadsPref,
        excludePEMU,
        cellKm,
        dMax,
        weightsNormalized: { ...w }
      },
      top10,   // each entry has .center, .score, .components, .inputs
      bbox     // from turf.bbox(land)
    };

    
    if (topLayer) map.removeLayer(topLayer);
    topLayer = L.geoJSON(topFC, {
      pane:'markers',
      pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:6,weight:2,color:'#fe0002',fillColor:'#fff',fillOpacity:1})
        .bindPopup(`<b>Candidate</b><br>Score: ${f.properties.score}`)
    }).addTo(map);
    if (ui.toggleTop && !ui.toggleTop.checked) map.removeLayer(topLayer);
    topLayer.bringToFront();

    ui.status.innerHTML = `<span class="ok">Done. Cells: ${hex.features.length}, Top10 shown.</span>`;
    ui.lu_readout.textContent = '—';
  }

 
  
    /* -------- wire up + go -------- */
    ui.runBtn.addEventListener('click', recompute);
    ui.btnClear.addEventListener('click', clearResults);
  
  function exportTop10CSV() {
    const snap = window.lastMCDA;
    if (!snap || !snap.top10?.length) {
      alert('No Top 10 available yet. Click “Recompute” first.');
      return;
    }
  
    const metaLines = [
      '# Rapid Suitability (MCDA-lite) — Top 10 Export',
      `# generated_at, ${snap.when}`,
      `# mode, ${snap.params.mode}`,
      `# roadsPref, ${snap.params.roadsPref}`,
      `# excludePEMU, ${snap.params.excludePEMU}`,
      `# cellKm, ${snap.params.cellKm}`,
      `# dMax_km, ${snap.params.dMax}`,
      `# weights_normalized, wifi=${snap.params.weightsNormalized.wifi}; amen=${snap.params.weightsNormalized.amen}; road=${snap.params.weightsNormalized.road}; lu=${snap.params.weightsNormalized.lu}; bld=${snap.params.weightsNormalized.bld}; pop=${snap.params.weightsNormalized.pop}`,
      ''
    ].join('\n');
  
    // Columns you’ll get per candidate row:
    const header = [
      'rank',
      'lat','lon',
      'score',
      // component scores (0–1):
      's_wifi','s_amen','s_road','s_lu','s_bld','s_pop',
      // raw inputs that fed the scoring:
      'dWifi_km','dAmen_km','dRoad_km','bldgCount100m',
      'landUseLabel','landUseScore',
      'popDensity_people_per_km2'
    ];
  
    let csv = header.join(',') + '\n';
  
    snap.top10.forEach((r, i) => {
      const coords = r.center?.geometry?.coordinates || [null, null];
      const lat = coords[1], lon = coords[0];
  
      const row = [
        i + 1,
        lat, lon,
        (r.score ?? ''),
        // component scores:
        (r.components?.s_wifi ?? ''),
        (r.components?.s_amen ?? ''),
        (r.components?.s_road ?? ''),
        (r.components?.s_lu   ?? ''),
        (r.components?.s_bld  ?? ''),
        (r.components?.s_pop  ?? ''),
        // raw inputs:
        (r.inputs?.dWifi_km ?? ''),
        (r.inputs?.dAmen_km ?? ''),
        (r.inputs?.dRoad_km ?? ''),
        (r.inputs?.bldgCount100m ?? ''),
        JSON.stringify(r.inputs?.landUseLabel ?? ''),
        (r.inputs?.landUseScore ?? ''),
        (r.inputs?.popDensity ?? '')
      ];
  
      csv += row.join(',') + '\n';
    });
  
    const blob = new Blob([metaLines + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'strathcona_top10_mcda.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  
  // Wire up the button
  document.getElementById('btnExportMCDA')?.addEventListener('click', exportTop10CSV);

  
  // PurpleAir toggle
  ui.togglePA.addEventListener('change', async (e) => {
    if (e.target.checked) {
      if (!paLayer) paLayer = await buildExternalPointsLayer(LAYER_URLS.purpleair, { color: '#7a1fa2', label: 'PurpleAir' });
      if (paLayer) { paLayer.addTo(map); paLayer.bringToFront?.(); }
    } else {
      if (paLayer) map.removeLayer(paLayer);
    }
  });
  
  // Stations toggle (data.js)
  ui.toggleStations.addEventListener('change', async (e) => {
    if (e.target.checked) {
      if (!stnLayer) stnLayer = await buildStationsLayer();
      if (stnLayer) { stnLayer.addTo(map); stnLayer.bringToFront?.(); }
    } else {
      if (stnLayer) map.removeLayer(stnLayer);
    }
  });
  
  init(); // load data, build display overlays, set Ready

});
