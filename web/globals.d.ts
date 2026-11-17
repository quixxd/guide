// Leaflet is loaded from a CDN <script> tag as the global L. Not deployed (only .js/.html/.php are needed).
declare const L: any;
interface Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

// Libraries loaded at run time from the jsDelivr CDN (see buildings.js).
declare module "https://cdn.jsdelivr.net/npm/*";
