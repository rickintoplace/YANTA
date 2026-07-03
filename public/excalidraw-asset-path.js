// window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

// Das hier und boot-appearance.js sind jetzt inline.
// Absicherung: Falls du das Inline-Script später auch nur um ein Whitespace änderst, blockt die CSP es und die DevTools-Console zeigt dir den korrekten neuen Hash zum Einsetzen an. Selbst berechnen geht so:

// bashnode -e "const c=require('fs').readFileSync('snippet.txt');console.log('sha256-'+require('crypto').createHash('sha256').update(c).digest('base64'))"

// (snippet.txt = exakt die Bytes zwischen <script> und </script>, inkl. der Newlines direkt nach <script> und vor </script>.)