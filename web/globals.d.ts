// Leaflet is loaded from a CDN <script> tag as the global L. Not deployed (only .js/.html/.php are needed).
declare const L: any;
interface Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}
