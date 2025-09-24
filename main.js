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
