/* global React */
// Minimal stroke-only icon set. 24px viewBox, currentColor.

const Ic = ({ children, size = 18, strokeWidth = 1.6, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    {children}
  </svg>
);

const IconHome = (p) => (
  <Ic {...p}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9h14v-9"/></Ic>
);
const IconProposal = (p) => (
  <Ic {...p}><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 12h6M10 16h6"/></Ic>
);
const IconTruck = (p) => (
  <Ic {...p}><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></Ic>
);
const IconScore = (p) => (
  <Ic {...p}><path d="M3 12a9 9 0 1 1 18 0"/><path d="M12 12l4-3"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></Ic>
);
const IconTable = (p) => (
  <Ic {...p}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 4v16"/></Ic>
);
const IconAdmin = (p) => (
  <Ic {...p}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></Ic>
);
const IconBack = (p) => (
  <Ic {...p}><path d="M15 5l-7 7 7 7"/></Ic>
);
const IconSearch = (p) => (
  <Ic {...p}><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></Ic>
);
const IconChevron = (p) => (
  <Ic {...p}><path d="m9 6 6 6-6 6"/></Ic>
);
const IconCheck = (p) => (
  <Ic {...p}><path d="M5 12.5 10 17 19 7"/></Ic>
);
const IconX = (p) => (
  <Ic {...p}><path d="M6 6l12 12M18 6 6 18"/></Ic>
);
const IconAlert = (p) => (
  <Ic {...p}><path d="M12 4 2.5 20h19z"/><path d="M12 10v5"/><circle cx="12" cy="17.5" r="0.8" fill="currentColor"/></Ic>
);
const IconInfo = (p) => (
  <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor"/></Ic>
);
const IconLock = (p) => (
  <Ic {...p}><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></Ic>
);
const IconClock = (p) => (
  <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Ic>
);
const IconPlus = (p) => (
  <Ic {...p}><path d="M12 5v14M5 12h14"/></Ic>
);
const IconUser = (p) => (
  <Ic {...p}><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/></Ic>
);
const IconBuilding = (p) => (
  <Ic {...p}><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2"/></Ic>
);
const IconFilter = (p) => (
  <Ic {...p}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></Ic>
);
const IconRefresh = (p) => (
  <Ic {...p}><path d="M21 12a9 9 0 1 1-3.5-7.1"/><path d="M21 4v5h-5"/></Ic>
);
const IconWifi = (p) => (
  <Ic {...p}><path d="M3 9a14 14 0 0 1 18 0"/><path d="M6 13a9 9 0 0 1 12 0"/><path d="M9 17a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r="0.8" fill="currentColor"/></Ic>
);
const IconHistory = (p) => (
  <Ic {...p}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v5l3 2"/></Ic>
);
const IconExport = (p) => (
  <Ic {...p}><path d="M12 4v11"/><path d="m7 9 5-5 5 5"/><path d="M5 19h14"/></Ic>
);
const IconMore = (p) => (
  <Ic {...p}><circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/></Ic>
);
const IconCD = (p) => (
  <Ic {...p}><path d="M3 10 12 4l9 6"/><path d="M5 10v9h14v-9"/><path d="M9 19v-5h6v5"/></Ic>
);
const IconPin = (p) => (
  <Ic {...p}><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.4"/></Ic>
);
const IconScale = (p) => (
  <Ic {...p}><path d="M12 4v16"/><path d="M5 8h14"/><path d="M5 8 3 13a3 3 0 0 0 6 0z"/><path d="m19 8-2 5a3 3 0 0 0 6 0z"/></Ic>
);

Object.assign(window, {
  IconHome, IconProposal, IconTruck, IconScore, IconTable, IconAdmin,
  IconBack, IconSearch, IconChevron, IconCheck, IconX, IconAlert, IconInfo,
  IconLock, IconClock, IconPlus, IconUser, IconBuilding, IconFilter,
  IconRefresh, IconWifi, IconHistory, IconExport, IconMore, IconCD,
  IconPin, IconScale,
});
