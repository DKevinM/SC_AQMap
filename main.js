window.addEventListener('load', () => {
  // bail if map wasn't created for some reason
  if (!window.map) {
    console.error('map is not defined yet');
    return;
  }

  // ensure layersControl exists (create a minimal one if you’re not using it elsewhere)
  if (!window.layersControl) {
    window.layersControl = L.control.layers(null, null, { collapsed: true }).addTo(map);
  }

const NPRI_WMS = 'https://maps-cartes.ec.gc.ca/arcgis/services/STB_DGST/NPRI/MapServer/WMSServer';

const npriFacilitiesWMS = L.tileLayer.wms(NPRI_WMS, {
  layers: '5',                // facilities locations (WMS index)
  format: 'image/png',
  transparent: true,
  opacity: 0.9,
  attribution: 'NPRI © ECCC'
});

layersControl.addOverlay(npriFacilitiesWMS, 'NPRI — Facilities (WMS)');
// optional: npriFacilitiesWMS.addTo(map);

const npriFacilityLabels = L.esri.featureLayer({
  url: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/STB_DGST/NPRI/MapServer/0', // facilities features
  pane: 'markers',         // your highest z-index pane
  pointToLayer: (_geo, latlng) =>
    // invisible-but-interactive target so hover triggers reliably
    L.circleMarker(latlng, {
      radius: 7,
      weight: 0,
      opacity: 0,
      fillOpacity: 0.001
    }),
  onEachFeature: (f, layer) => {
    const name = f?.properties?.FacilityName || f?.properties?.Facility || 'Facility';
    layer.bindTooltip(name, {
      permanent: false,   // hover-only
      sticky: true,
      direction: 'right',
      offset: [6, 0],
      className: 'npri-label'
    });
  }
});

// show/hide via your checkbox if present, else add to map
const toggle = document.getElementById('toggleNPRILabels');
const enableLabels = () => { npriFacilityLabels.addTo(map).bringToFront(); };
const disableLabels = () => { map.removeLayer(npriFacilityLabels); };

if (toggle) {
  toggle.addEventListener('change', e => e.target.checked ? enableLabels() : disableLabels());
  if (toggle.checked) enableLabels();
} else {
  // fallback: just enable labels
  enableLabels();
}
layersControl.addOverlay(npriFacilityLabels, 'NPRI — Facility labels');
    
function addNpriFacilitiesStrathcona() {
  Promise.all([
    fetch('data/strathcona_boundary.geojson').then(r => r.json())
  ]).then(([county]) => {
    L.esri.query({
      url: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/STB_DGST/NPRI/MapServer/0' // facilities
    })
    .within(county)   // server-side spatial filter
    .run((err, fc) => {
      if (err) { console.error('NPRI query error:', err); return; }

      const npriFacilities = L.geoJSON(fc, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 5, weight: 1, fillOpacity: 0.8 }),
        onEachFeature: (f, layer) => {
          const p = f.properties || {};
          layer.bindPopup(`
            <strong>${p.FacilityName || 'Facility'}</strong><br>
            Company: ${p.CompanyName ?? 'n/a'}<br>
            NAICS: ${p.NAICS ?? 'n/a'}<br>
            Year: ${p.ReportingYear ?? '2023'}
          `);
        }
      });

      layersControl.addOverlay(npriFacilities, 'NPRI — Facilities (SC only)');
      // optional: npriFacilities.addTo(map);
    });
  });
}

// call it after map + layersControl exist:
addNpriFacilitiesStrathcona();
  
});
