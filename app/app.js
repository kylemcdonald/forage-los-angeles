const PROJECT_BASE = window.location.pathname.replace(/\/(?:app\/)?$/, '/');
const DATA_URL = `${PROJECT_BASE}data/forage_trees.json`;
const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth() + 1;

const state = {
  mode: 'search',
  speciesQuery: '',
  browseSpeciesId: '',
  inSeasonOnly: false,
  data: null,
  filteredPoints: [],
  location: null,
  heading: null,
};

const el = {
  speciesInput: document.getElementById('speciesInput'),
  speciesSelect: document.getElementById('speciesSelect'),
  searchWrap: document.getElementById('searchWrap'),
  browseWrap: document.getElementById('browseWrap'),
  modeSearch: document.getElementById('modeSearch'),
  modeBrowse: document.getElementById('modeBrowse'),
  suggestions: document.getElementById('suggestions'),
  clearSpecies: document.getElementById('clearSpecies'),
  inSeasonOnly: document.getElementById('inSeasonOnly'),
  stats: document.getElementById('stats'),
  enableSensors: document.getElementById('enableSensors'),
  compassInfo: document.getElementById('compassInfo'),
  arrow: document.getElementById('arrow'),
};

let map;
const SOURCE_ID = 'forage-source';
const LAYER_ID = 'forage-circles';
const USER_SOURCE_ID = 'user-source';
const USER_LAYER_ID = 'user-location';
const USER_ARROW_LAYER_ID = 'user-bearing-arrow';
const ROUTE_SOURCE_ID = 'nearest-route-source';
const ROUTE_LAYER_ID = 'nearest-route-layer';
const TARGET_SOURCE_ID = 'nearest-target-source';
const TARGET_LAYER_ID = 'nearest-target-layer';

function monthInSeason(month, start, end) {
  if (start <= end) return month >= start && month <= end;
  return month >= start || month <= end;
}

function seasonStage(month, start, end) {
  if (!monthInSeason(month, start, end)) return 'out';
  const span = start <= end ? end - start + 1 : (12 - start + 1) + end;
  const offset = (() => {
    if (start <= end) return month - start;
    if (month >= start) return month - start;
    return 12 - start + month;
  })();
  const pct = span <= 1 ? 1 : offset / (span - 1);
  if (pct <= 0.33) return 'beginning';
  if (pct <= 0.66) return 'middle';
  return 'end';
}

function colorForStage(stage) {
  if (stage === 'beginning') return '#00c853';
  if (stage === 'middle') return '#ffd600';
  if (stage === 'end') return '#ff3d00';
  return '#40c4ff';
}

function getSpeciesById(id) {
  return state.data.species[id];
}

function isSpeciesInSeason(species) {
  return monthInSeason(CURRENT_MONTH, species.seasonStart, species.seasonEnd);
}

function toGeoJSON(points) {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => {
      const species = getSpeciesById(p[2]);
      const stage = seasonStage(CURRENT_MONTH, species.seasonStart, species.seasonEnd);
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [p[1], p[0]],
        },
        properties: {
          species: species.name,
          stage,
          color: colorForStage(stage),
          radius: 4,
        },
      };
    }),
  };
}

function renderSuggestions() {
  if (state.mode !== 'search') {
    el.suggestions.style.display = 'none';
    return;
  }

  const q = state.speciesQuery.trim().toLowerCase();
  el.suggestions.innerHTML = '';

  if (!q) {
    el.suggestions.style.display = 'none';
    return;
  }

  const matches = state.data.species
    .filter((s) => s.name.toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  if (!matches.length) {
    el.suggestions.style.display = 'none';
    return;
  }

  for (const s of matches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${s.name} (${s.count.toLocaleString()})`;
    btn.addEventListener('click', () => {
      state.speciesQuery = s.name;
      el.speciesInput.value = s.name;
      el.suggestions.style.display = 'none';
      applyFilters();
    });
    el.suggestions.appendChild(btn);
  }

  el.suggestions.style.display = 'block';
}

function renderStats() {
  const shown = state.filteredPoints.length;
  el.stats.textContent = `${shown.toLocaleString()} results`;
}

function renderModeUI() {
  const searchMode = state.mode === 'search';
  el.searchWrap.style.display = searchMode ? 'block' : 'none';
  el.browseWrap.style.display = searchMode ? 'none' : 'block';
  el.modeSearch.classList.toggle('active', searchMode);
  el.modeBrowse.classList.toggle('active', !searchMode);
  if (!searchMode) {
    el.suggestions.style.display = 'none';
  }
}

function rebuildBrowseOptions() {
  const previousValue = state.browseSpeciesId;
  const species = state.data.species
    .filter((s) => !state.inSeasonOnly || isSpeciesInSeason(s))
    .sort((a, b) => b.count - a.count);

  el.speciesSelect.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All species';
  el.speciesSelect.appendChild(allOption);

  for (const s of species) {
    const option = document.createElement('option');
    option.value = String(s.id);
    option.textContent = `${s.name} (${s.count.toLocaleString()})`;
    el.speciesSelect.appendChild(option);
  }

  const exists = species.some((s) => String(s.id) === previousValue);
  state.browseSpeciesId = exists ? previousValue : '';
  el.speciesSelect.value = state.browseSpeciesId;
}

function setMode(mode) {
  state.mode = mode;
  renderModeUI();
  if (mode === 'search') {
    state.browseSpeciesId = '';
    el.speciesSelect.value = '';
  } else {
    state.speciesQuery = '';
    el.speciesInput.value = '';
    rebuildBrowseOptions();
  }
  applyFilters();
}

function renderMapData() {
  const source = map.getSource(SOURCE_ID);
  if (!source) return;
  source.setData(toGeoJSON(state.filteredPoints));
}

function getNearestVisibleTree() {
  if (!state.location || !state.filteredPoints.length) return null;

  let nearest = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const p of state.filteredPoints) {
    const d = distanceMeters(state.location.lat, state.location.lon, p[0], p[1]);
    if (d < minDistance) {
      minDistance = d;
      nearest = p;
    }
  }

  if (!nearest) return null;

  const bearing = bearingDeg(state.location.lat, state.location.lon, nearest[0], nearest[1]);
  return { nearest, minDistance, bearing };
}

function setSourceData(id, data) {
  if (!map) return;
  const source = map.getSource(id);
  if (source) source.setData(data);
}

function updateMapGuidance() {
  if (!map || !map.getSource(USER_SOURCE_ID)) return;

  if (!state.location) {
    setSourceData(USER_SOURCE_ID, { type: 'FeatureCollection', features: [] });
    setSourceData(ROUTE_SOURCE_ID, { type: 'FeatureCollection', features: [] });
    setSourceData(TARGET_SOURCE_ID, { type: 'FeatureCollection', features: [] });
    return;
  }

  const nearestData = getNearestVisibleTree();
  const userFeature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [state.location.lon, state.location.lat],
    },
    properties: {
      rotation: nearestData ? nearestData.bearing : 0,
    },
  };
  setSourceData(USER_SOURCE_ID, { type: 'FeatureCollection', features: [userFeature] });

  if (!nearestData) {
    setSourceData(ROUTE_SOURCE_ID, { type: 'FeatureCollection', features: [] });
    setSourceData(TARGET_SOURCE_ID, { type: 'FeatureCollection', features: [] });
    return;
  }

  const lineFeature = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [state.location.lon, state.location.lat],
        [nearestData.nearest[1], nearestData.nearest[0]],
      ],
    },
    properties: {},
  };

  const targetFeature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [nearestData.nearest[1], nearestData.nearest[0]],
    },
    properties: {},
  };

  setSourceData(ROUTE_SOURCE_ID, { type: 'FeatureCollection', features: [lineFeature] });
  setSourceData(TARGET_SOURCE_ID, { type: 'FeatureCollection', features: [targetFeature] });
}

function applyFilters() {
  let matchingIds = null;

  if (state.mode === 'search') {
    const q = state.speciesQuery.trim().toLowerCase();
    if (q) {
      matchingIds = new Set(
        state.data.species.filter((s) => s.name.toLowerCase().includes(q)).map((s) => s.id)
      );
    }
  } else if (state.browseSpeciesId !== '') {
    matchingIds = new Set([Number(state.browseSpeciesId)]);
  }

  state.filteredPoints = state.data.points.filter((point) => {
    const sid = point[2];
    const species = getSpeciesById(sid);
    if (matchingIds && !matchingIds.has(sid)) return false;
    if (state.inSeasonOnly && !monthInSeason(CURRENT_MONTH, species.seasonStart, species.seasonEnd)) return false;
    return true;
  });

  renderStats();
  renderMapData();
  updateCompassTarget();
  updateMapGuidance();
}

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [-118.2437, 34.0522],
    zoom: 10,
    maxZoom: 18,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  map.on('load', () => {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addSource(USER_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addSource(TARGET_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['get', 'radius'],
        'circle-opacity': 0.95,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
      },
    });

    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': '#0057ff',
        'line-width': 4,
        'line-opacity': 0.92,
        'line-dasharray': [2, 1.5],
      },
    });

    map.addLayer({
      id: TARGET_LAYER_ID,
      type: 'circle',
      source: TARGET_SOURCE_ID,
      paint: {
        'circle-color': '#ff1744',
        'circle-radius': 7,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    map.addLayer({
      id: USER_LAYER_ID,
      type: 'circle',
      source: USER_SOURCE_ID,
      paint: {
        'circle-color': '#0066ff',
        'circle-radius': 8,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
      },
    });

    map.addLayer({
      id: USER_ARROW_LAYER_ID,
      type: 'symbol',
      source: USER_SOURCE_ID,
      layout: {
        'text-field': '➤',
        'text-size': 26,
        'text-rotate': ['get', 'rotation'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#0036c7',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
      },
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

    map.on('mousemove', LAYER_ID, (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      const p = f.properties;
      popup
        .setLngLat(e.lngLat)
        .setHTML(`${p.species}<br/>${p.stage}`)
        .addTo(map);
    });

    map.on('mouseleave', LAYER_ID, () => {
      popup.remove();
    });

    applyFilters();
  });
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function normalizeDeltaDeg(deg) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function updateCompassTarget() {
  if (!state.location) {
    el.compassInfo.textContent = 'Enable sensors to start guidance.';
    return;
  }

  const nearestData = getNearestVisibleTree();
  if (!nearestData) {
    el.compassInfo.textContent = 'No visible edible trees with current filters.';
    return;
  }

  const { nearest, minDistance, bearing } = nearestData;
  const s = getSpeciesById(nearest[2]);
  const heading = state.heading ?? 0;
  const delta = normalizeDeltaDeg(bearing - heading);
  el.arrow.style.transform = `translate(-50%, -100%) rotate(${delta}deg)`;

  const stage = seasonStage(CURRENT_MONTH, s.seasonStart, s.seasonEnd);
  el.compassInfo.textContent = `${s.name} | ${Math.round(minDistance)} m away | heading ${Math.round(bearing)}° | season: ${stage}`;
}

async function enableSensors() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        el.compassInfo.textContent = 'Orientation permission not granted.';
        return;
      }
    } catch {
      el.compassInfo.textContent = 'Could not request orientation permission.';
      return;
    }
  }

  window.addEventListener('deviceorientation', (event) => {
    if (typeof event.webkitCompassHeading === 'number') {
      state.heading = event.webkitCompassHeading;
    } else if (typeof event.alpha === 'number') {
      state.heading = (360 - event.alpha) % 360;
    }
    updateCompassTarget();
  });

  if (!navigator.geolocation) {
    el.compassInfo.textContent = 'Geolocation is not supported on this device.';
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      state.location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      updateCompassTarget();
      updateMapGuidance();
      if (map && !map.__centeredOnce) {
        map.__centeredOnce = true;
        map.flyTo({ center: [state.location.lon, state.location.lat], zoom: 14 });
      }
    },
    (err) => {
      el.compassInfo.textContent = `GPS error: ${err.message}`;
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );

  el.compassInfo.textContent = 'Sensors enabled. Move phone flat to orient toward nearest tree.';
}

function bindEvents() {
  el.modeSearch.addEventListener('click', () => {
    setMode('search');
  });

  el.modeBrowse.addEventListener('click', () => {
    setMode('browse');
  });

  el.speciesInput.addEventListener('input', (e) => {
    state.speciesQuery = e.target.value;
    renderSuggestions();
    applyFilters();
  });

  el.speciesSelect.addEventListener('change', (e) => {
    state.browseSpeciesId = e.target.value;
    applyFilters();
  });

  el.inSeasonOnly.addEventListener('change', (e) => {
    state.inSeasonOnly = e.target.checked;
    rebuildBrowseOptions();
    applyFilters();
  });

  el.clearSpecies.addEventListener('click', () => {
    state.speciesQuery = '';
    state.browseSpeciesId = '';
    el.speciesInput.value = '';
    el.speciesSelect.value = '';
    el.suggestions.style.display = 'none';
    applyFilters();
  });

  document.addEventListener('click', (e) => {
    if (!el.suggestions.contains(e.target) && e.target !== el.speciesInput) {
      el.suggestions.style.display = 'none';
    }
  });

  el.enableSensors.addEventListener('click', enableSensors);
}

async function boot() {
  const response = await fetch(DATA_URL);
  state.data = await response.json();
  rebuildBrowseOptions();
  renderModeUI();
  bindEvents();
  initMap();
}

boot().catch((err) => {
  el.stats.textContent = `Failed to load data: ${err.message}`;
});
