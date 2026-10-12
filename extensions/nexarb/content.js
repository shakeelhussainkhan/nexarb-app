// NexArb content script — runs on Amazon product pages.
// It ONLY reads the ASIN (from the URL) and the product title (from the
// DOM) so the popup can display them. It never reads cookies, never touches
// forms or checkout, and never sends anything to Amazon — the only network
// call the extension makes is to YOUR NexArb API with YOUR api key.

function asinFromUrl(url) {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /[?&]asin=([A-Z0-9]{10})(?:[&#]|$)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function productTitle() {
  const el = document.getElementById("productTitle");
  return el ? el.textContent.trim().slice(0, 200) : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg && msg.type === "NEXARB_GET_PRODUCT") {
    respond({ asin: asinFromUrl(window.location.href), title: productTitle() });
    return true;
  }
  return false;
});
