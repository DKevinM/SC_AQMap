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


// --- CONFIG: 2018 Strathcona enumeration areas (GeoJSON) ---
if (!window.CONFIG) window.CONFIG = {};
Object.assign(window.CONFIG, {
  censusEA: {
    url: "https://services.arcgis.com/B7ZrK1Hv4P1dsm9R/arcgis/rest/services/2018_Municipal_Census___Enumeration_Areas_Map/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson",
    // optional: filter to a bbox if you want only Strathcona (leave null to take all)
    bbox: null, // e.g., [-113.5, 53.3, -112.9, 53.8]
  }
});

/** Fetch the 2018 Census EA GeoJSON and compute density (people/km^2) */
async function fetchCensusEAWithDensity() {
  const { url, bbox } = window.CONFIG.censusEA;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Census EA fetch failed: ${r.status}`);
  const gj = await r.json();

  const features = (gj.features || []).filter(f => f && f.properties);

  for (const f of features) {
    const p = f.properties;
    // Expect fields: tot_pop, Shape_Area (m^2 from source)
    const tot = Number(p.tot_pop ?? p.TOT_POP ?? p.TOTAL_POP ?? 0);
    const area_m2 = Number(p.Shape_Area ?? p.shape_area ?? 0);
    const km2 = area_m2 > 0 ? area_m2 / 1e6 : 0;
    const dens = km2 > 0 ? tot / km2 : 0;
    p._pop_total = isFinite(tot) ? tot : 0;
    p._area_km2  = isFinite(km2) ? km2 : 0;
    p._density   = isFinite(dens) ? dens : 0;
  }

  // optional spatial clip to bbox (client-side; keep simple)
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [xmin, ymin, xmax, ymax] = bbox;
    gj.features = features.filter(f => {
      const g = f.geometry;
      if (!g) return false;
      const coords = g.type === "Polygon" ? g.coordinates.flat(2) :
                     g.type === "MultiPolygon" ? g.coordinates.flat(3) : [];
      // keep any vertex within bbox (fast but coarse)
      for (let i = 0; i < coords.length; i += 2) {
        const x = coords[i], y = coords[i+1];
        if (x >= xmin && x <= xmax && y >= ymin && y <= ymax) return true;
      }
      return false;
    });
  } else {
    gj.features = features;
  }

  return gj;
}
window.fetchCensusEAWithDensity = fetchCensusEAWithDensity;

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
