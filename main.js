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
