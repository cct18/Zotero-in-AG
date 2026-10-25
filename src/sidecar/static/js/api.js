// Backend REST API client for Zotero in AG Sidecar

export async function fetchHealth() {
  const res = await fetch('/api/health');
  return await res.json();
}

export async function fetchCollections() {
  const res = await fetch('/api/collections');
  return await res.json();
}

export async function fetchItems(sortBy = 'date_desc', collectionKey = null, query = '') {
  let url = `/api/items?limit=100&sort=${encodeURIComponent(sortBy)}`;
  if (collectionKey) {
    url += `&collection_key=${encodeURIComponent(collectionKey)}`;
  }
  if (query) {
    url += `&query=${encodeURIComponent(query)}`;
  }
  const res = await fetch(url);
  return await res.json();
}

export async function fetchItemDetail(itemKey) {
  const res = await fetch(`/api/item/${encodeURIComponent(itemKey)}`);
  return await res.json();
}

export async function locateItem(itemKey) {
  const res = await fetch(`/api/locate/${encodeURIComponent(itemKey)}`, { method: 'POST' });
  return await res.json();
}

export async function translateText(payload) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
}

export async function testAiModel(payload) {
  const res = await fetch('/api/test_ai_model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function fetchAnnotations(itemKey) {
  const res = await fetch(`/api/annotations/${encodeURIComponent(itemKey)}`);
  return await res.json();
}

export async function saveAnnotationOnServer(itemKey, ann) {
  const res = await fetch(`/api/annotations/${encodeURIComponent(itemKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ann),
  });
  return await res.json();
}

export async function deleteAnnotationOnServer(itemKey, annId) {
  if (!itemKey || !annId) return { success: false };
  if (String(annId).startsWith('zotero_')) return { success: false, error: 'Read-only Zotero annotation' };
  const res = await fetch(`/api/annotations/${encodeURIComponent(itemKey)}/${encodeURIComponent(annId)}`, {
    method: 'DELETE',
  });
  return await res.json();
}
