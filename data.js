// data.js
let recentData = [];
let dataByStation = {};
window.dataByStation = dataByStation; 



const unitsLookup = {
  "AQHI": " ", "Ozone": " ppb", "Total Oxides of Nitrogen": " ppb",
  "Hydrogen Sulphide": " ppb", "Total Reduced Sulphur": " ppb", "Sulphur Dioxide": " ppb",
  "Fine Particulate Matter": " µg/m³", "Total Hydrocarbons": " ppm", "Carbon Monoxide": " ppm",
  "Wind Direction": " degrees", "Relative Humidity": " %", "Outdoor Temperature": " °C",
  "Nitric Oxide": " ppb", "Wind Speed": " km/hr", "Non-methane Hydrocarbons": " ppm",
  "Nitrogen Dioxide": " ppb", "Methane": " ppm"
};

const abbrLookup = {
  "AQHI": "AQHI", "Ozone": "O₃", "Total Oxides of Nitrogen": "NOx",
  "Hydrogen Sulphide": "H₂S", "Total Reduced Sulphur": "TRS", "Sulphur Dioxide": "SO₂",
  "Fine Particulate Matter": "PM2.5", "Total Hydrocarbons": "THC", "Carbon Monoxide": "CO",
  "Wind Direction": "wd", "Relative Humidity": "RH", "Outdoor Temperature": "ET",
  "Nitric Oxide": "NO", "Wind Speed": "ws", "Non-methane Hydrocarbons": "NMHC",
  "Nitrogen Dioxide": "NO₂", "Methane": "CH₄"
};

const shortLookup = {
  "AQHI": "AQHI", "Ozone": "O3", "Total Oxides of Nitrogen": "NOX",
  "Hydrogen Sulphide": "H2S", "Total Reduced Sulphur": "TRS", "Sulphur Dioxide": "SO2",
  "Fine Particulate Matter": "PM2.5", "Total Hydrocarbons": "THC", "Carbon Monoxide": "CO",
  "Wind Direction": "wd", "Relative Humidity": "RH", "Outdoor Temperature": "ET",
  "Nitric Oxide": "NO", "Wind Speed": "ws", "Non-methane Hydrocarbons": "NMHC",
  "Nitrogen Dioxide": "NO2", "Methane": "CH4"
};


// --- 2018 Census EA (Strathcona) ---
if (!window.CONFIG) window.CONFIG = {};
Object.assign(window.CONFIG, {
  censusEA: {
    base: "https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/2018_Municipal_Census___Enumeration_Areas_Map/FeatureServer/0/query",
    bbox: null // optional client-side clip
  }
});

async function fetchCensusEAWithDensity() {
  const base = window.CONFIG.censusEA.base;

  const chunk = 2000;
  let offset = 0;
  let all = [];

  while (true) {
    const url = new URL(base);
    url.searchParams.set("where", "1=1");
    url.searchParams.set("outFields", "*");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("f", "geojson");
    url.searchParams.set("returnExceededLimitFeatures", "true");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(chunk));
    // Useful for consistent pagination; harmless if field name differs
    url.searchParams.set("orderByFields", "OBJECTID");

    console.debug("[CENSUS] GET", url.toString());
    const resp = await fetch(url.toString(), { cache: "no-store" });
    const text = await resp.text();

    let gj;
    try {
      gj = JSON.parse(text);
    } catch (e) {
      console.error("[CENSUS] Non-JSON response first 200 chars:", text.slice(0, 200));
      throw new Error("ArcGIS did not return JSON");
    }

    if (gj.error) {
      console.error("[CENSUS] ArcGIS error:", gj.error);
      throw new Error(gj.error.message || "ArcGIS error");
    }
    if (gj.type !== "FeatureCollection") {
      console.error("[CENSUS] Unexpected payload type:", gj.type, "sample:", JSON.stringify(gj).slice(0, 200));
      throw new Error("Not a GeoJSON FeatureCollection");
    }

    const feats = Array.isArray(gj.features) ? gj.features : [];
    all = all.concat(feats);

    if (feats.length < chunk) break;
    offset += feats.length;
    if (offset > 1_000_000) break; // safety
  }

  // Compute density
  for (const f of all) {
    const p = f.properties || {};
    const tot = Number(p.tot_pop ?? p.TOT_POP ?? p.TOTAL_POP ?? 0);
    const m2  = Number(p.Shape_Area ?? p.shape_area ?? 0); // m²
    const km2 = m2 > 0 ? m2 / 1e6 : 0;
    p._pop_total = Number.isFinite(tot) ? tot : 0;
    p._area_km2  = Number.isFinite(km2) ? km2 : 0;
    p._density   = km2 > 0 ? (tot / km2) : 0;
    f.properties = p;
  }

  // Optional clip to bbox (coarse vertex test)
  const bbox = window.CONFIG.censusEA.bbox;
  const features = (Array.isArray(bbox) && bbox.length === 4)
    ? all.filter(f => {
        const g = f.geometry;
        if (!g) return false;
        const [xmin, ymin, xmax, ymax] = bbox;
        const coords = g.type === "Polygon" ? g.coordinates.flat(2)
                     : g.type === "MultiPolygon" ? g.coordinates.flat(3) : [];
        for (let i = 0; i < coords.length; i += 2) {
          const x = coords[i], y = coords[i+1];
          if (x >= xmin && x <= xmax && y >= ymin && y <= ymax) return true;
        }
        return false;
      })
    : all;

  return { type: "FeatureCollection", features };
}
window.fetchCensusEAWithDensity = fetchCensusEAWithDensity;



// data.js

// Helper: turn arrays/loose JSON into a FeatureCollection of points
function toPointFC(json) {
  const arr = Array.isArray(json) ? json : (json.data || json.features || Object.values(json || {}));
  if (!arr?.length) return { type:'FeatureCollection', features:[] };
  const latK = ['lat','latitude','Latitude','LAT','Lat'].find(k => k in arr[0]) || 'lat';
  const lonK = ['lon','lng','long','longitude','Longitude','LON','Lng'].find(k => k in arr[0]) || 'lon';
  return {
    type:'FeatureCollection',
    features: arr.map(r => ({
      type:'Feature',
      properties: { ...r },
      geometry: { type:'Point', coordinates: [ +r[lonK], +r[latK] ] }
    })).filter(f => Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1]))
  };
}

// 1) Government stations → FeatureCollection
// Assumes you already have window.dataReady + window.fetchAllStationData in data.js
window.stationsFCReady = (async () => {
  try {
    await window.dataReady;
    const rows = await window.fetchAllStationData();
    const fc = {
      type:'FeatureCollection',
      features: (rows || []).map(r => ({
        type:'Feature',
        properties: { ...r },
        geometry: { type:'Point', coordinates: [ +r.lon, +r.lat ] }
      })).filter(f => Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1]))
    };
    return fc;
  } catch (e) {
    console.error('[stationsFCReady] failed', e);
    return { type:'FeatureCollection', features:[] };
  }
})();

// 2) PurpleAir → FeatureCollection
window.purpleFCReady = (async () => {
  try {
    const res = await fetch('https://raw.githubusercontent.com/DKevinM/AB_datapull/main/data/AB_PM25_map.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return toPointFC(json);
  } catch (e) {
    console.error('[purpleFCReady] failed', e);
    return { type:'FeatureCollection', features:[] };
  }
})();










/** Utility: download text as a file */
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
window.downloadText = downloadText;


window.dataReady = fetch('https://raw.githubusercontent.com/DKevinM/AB_datapull/main/data/last6h.csv')
  .then(res => res.text())
  .then(text => {
    const rows = text.trim().split('\n');
    const headers = rows.shift().split(',');

    const raw = {};
    rows.forEach(line => {
      const cols = line.split(',');
      const e = Object.fromEntries(headers.map((h,i)=>[h,cols[i]]));
      if (!e.Latitude||!e.Longitude||isNaN(e.Latitude)||isNaN(e.Longitude)) return;

      e.ParameterName = e.ParameterName||"AQHI";
      e.Units = unitsLookup[e.ParameterName]||"";
      e.Abbreviation = abbrLookup[e.ParameterName]||"";
      e.Shortform = shortLookup[e.ParameterName]||"";

      let v = parseFloat(e.Value);
      if (["Ozone","Total Oxides of Nitrogen","Hydrogen Sulphide","Total Reduced Sulphur","Sulphur Dioxide","Nitric Oxide","Nitrogen Dioxide"].includes(e.ParameterName)) {
        v *= 1000;
      }
      if (isNaN(v)) return;
      e.Value = v;

      const utc = new Date(e.ReadingDate);
      e.DisplayDate = utc.toLocaleString("en-CA", {
        timeZone: "America/Edmonton",
        hour12: true
      });
      
      // Keep original ReadingDate as valid ISO string or Date object
      e.ReadingDate = utc.toISOString();


      raw[e.StationName] = raw[e.StationName]||[];
      raw[e.StationName].push(e);
    });

    Object.entries(raw).forEach(([station, arr]) => {
      arr.sort((a, b) => new Date(b.ReadingDate) - new Date(a.ReadingDate));
      const byParam = {};
      arr.forEach(e => {
        const param = e.ParameterName;
        if (!byParam[param] || new Date(e.ReadingDate) > new Date(byParam[param].ReadingDate)) {
          byParam[param] = e;
        }
      });
      dataByStation[station] = Object.values(byParam);
      recentData.push(...dataByStation[station]);
    });
  });


window.fetchAllStationData = function () {
  const stationNames = Object.keys(dataByStation);
  if (stationNames.length === 0) {
    return Promise.resolve([]);
  }

const orderedParams = [
    "AQHI", "Outdoor Temperature", "Relative Humidity", "Wind Speed", "Wind Direction", 
    "Nitrogen Dioxide", "Total Oxides of Nitrogen", "Nitric Oxide", "Ozone",
    "Fine Particulate Matter", "Sulphur Dioxide", "Hydrogen Sulphide", "Total Reduced Sulphur",
    "Carbon Monoxide", "Total Hydrocarbons", "Methane", "Non-methane Hydrocarbons"  
];


const shortformOverride = {
      "Outdoor Temperature": "Temp",
      "Relative Humidity": "Humidity",
      "Wind Speed": "Wind Speed",
      "Wind Direction": "Wind Dir"
};


  const results = stationNames.map(stationName => {
    const stationData = dataByStation[stationName];
    if (!stationData || stationData.length === 0) return null;

    const paramLookup = {};
    let latestTime = null;
    for (const r of stationData) {
      paramLookup[r.ParameterName] = r;
      const t = new Date(r.ReadingDate);
      if (!latestTime || t > latestTime) latestTime = t;
    }

    const displayTime = latestTime
      ? latestTime.toLocaleString("en-CA", { timeZone: "America/Edmonton", hour12: true })
      : "Invalid Date";

    const lines = orderedParams
      .filter(p => paramLookup[p] && p !== "AQHI")
      .map(p => {
        const r = paramLookup[p];
        const label = shortformOverride[p] || r.Shortform || p;
        const value = r.Value;
        const unit = r.Units || "";
        return `${label}: ${value}${unit}`;
      });

    const aqhiValue = paramLookup["AQHI"]?.Value || "N/A";
    const lat = stationData[0].Latitude;
    const lon = stationData[0].Longitude;

    return {
      stationName,
      lat,
      lon,
      aqhi: aqhiValue,
      html: `
        <div style="font-size:0.9em;">
          <strong>${stationName}</strong><br>
          <small><em>${displayTime}</em></small><br>
          AQHI: ${aqhiValue > 10 ? "10+" : aqhiValue}<br>
          ${lines.join("<br>")}
        </div>
      `
    };
  }).filter(Boolean);

  return Promise.resolve(results);
};
