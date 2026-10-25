/**
 * Skin fonts (all SIL Open Font License). Declaring a face costs nothing: the browser fetches
 * a file only when a skin uses it, and the service worker keeps it for offline use.
 */

import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import '@fontsource/vt323/latin-400.css';
import dseg7 from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2?url';

// Seven-segment digits for the 1980s LCD readouts (the package ships no CSS).
if ('fonts' in document) document.fonts.add(new FontFace('DSEG7 Classic', `url(${dseg7}) format('woff2')`, { weight: '700', display: 'swap' }));
