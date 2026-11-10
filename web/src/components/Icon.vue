<script setup>
// Phase 48: modern stroke icons — app ke purane emoji icons ki
// jagah ek saaf, ek-jaisa SVG set (24x24, round caps). Naam se
// bulao: <Icon name="home" :size="22" />
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 22 },
});
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20a1 1 0 0 0 1 1h4.2v-6h3.6v6H18a1 1 0 0 0 1-1V9.8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.8"/>',
  cap: '<path d="M2.5 9 12 4l9.5 5L12 14 2.5 9Z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/><path d="M21.5 9v4.5"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M3.2 20c.6-3.1 2.9-4.9 5.8-4.9s5.2 1.8 5.8 4.9"/><path d="M15.8 4.9a3.4 3.4 0 0 1 0 6"/><path d="M18.3 15.5c1.5.7 2.5 2 2.9 3.9"/>',
  "check-circle": '<circle cx="12" cy="12" r="8.8"/><path d="m8.4 12.3 2.4 2.4 4.8-5.2"/>',
  scan: '<path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8"/><path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8"/><path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16"/><path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"/><path d="M3 12h18"/>',
  shield: '<path d="M12 3 5 5.8v5.4c0 4.6 3 7.7 7 9.3 4-1.6 7-4.7 7-9.3V5.8L12 3Z"/><path d="m9 11.6 2.2 2.2 4-4.2"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="4" rx="1"/><path d="M9 11.5h6"/><path d="M9 15.5h4"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  "calendar-check": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="m9.3 16.2 1.9 1.9 3.6-3.9"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  download: '<path d="M12 3v10.5"/><path d="m6.8 10 5.2 5.2L17.2 10"/><path d="M4 19.5h16"/>',
  crown: '<path d="m3 8 4.2 3.8L12 6l4.8 5.8L21 8l-1.6 9.5H4.6L3 8Z"/><path d="M5 21h14"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 20l1-5.6A8.5 8.5 0 1 1 21 11.5Z"/>',
  megaphone: '<path d="m3 11 18-5.5v13L3 13v-2Z"/><path d="M6.8 13.3v5.2a1.9 1.9 0 0 0 3.8 0v-3.9"/>',
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  sliders: '<path d="M3 6.5h9.5"/><circle cx="15.5" cy="6.5" r="2.3"/><path d="M18 6.5h3"/><path d="M3 17.5h3"/><circle cx="8.5" cy="17.5" r="2.3"/><path d="M11 17.5h10"/><path d="M3 12h13"/><circle cx="18.5" cy="12" r="2.3"/><path d="M21 12h.01"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.4c.8-3.7 3.6-5.6 7-5.6s6.2 1.9 7 5.6"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7v5.2l3.4 2"/>',
  pencil: '<path d="M17 3.6a2.8 2.8 0 1 1 4 4L8.6 20 3 21.5 4.5 15.9 17 3.6Z"/><path d="m14.5 6 4 4"/>',
  camera: '<path d="M4 8h2.6l2-2.8h6.8L17.4 8H20a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.2"/>',
  drop: '<path d="M12 3.5s6.5 6.9 6.5 11a6.5 6.5 0 0 1-13 0c0-4.1 6.5-11 6.5-11Z"/>',
};
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="PATHS[name] || ''"></svg>
</template>
