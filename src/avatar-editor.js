import { loadAvatarSource, cropAvatar } from './images.js';
import { initialCrop, cropRect, zoomCrop, gestureCrop, cropLayout } from './crop.js';
import { t, errorText } from './i18n.js';

// 画像選択から保存前プレビューまでの一時状態。IndexedDBへは確定済みBlobだけを渡す。
export function setupAvatarEditor() {
  const personDialog = document.getElementById('person-dialog');
  const cropDialog = document.getElementById('avatar-crop-dialog');
  const input = document.getElementById('person-image');
  input.accept = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif';
  input.closest('label').querySelector('small').textContent = t('avatarHelp');
  const remove = document.getElementById('person-remove-image');
  const error = document.getElementById('person-error');
  const viewport = document.getElementById('crop-viewport');
  const slider = document.getElementById('crop-zoom');
  const cropError = document.getElementById('crop-error');
  const confirm = document.getElementById('crop-confirm');
  const cancel = document.getElementById('crop-cancel');
  const close = document.getElementById('crop-close');
  const preview = document.createElement('div'); preview.id = 'person-image-preview';
  preview.className = 'image-preview'; preview.hidden = true;
  const previewImage = document.createElement('img'); previewImage.alt = '';
  const previewLabel = document.createElement('span');
  preview.append(previewImage, previewLabel); input.closest('label').after(preview);

  let source = null, crop = null, pending = null, pendingUrl = null, existingUrl = null;
  let generation = 0, saving = false, gestureStart = null;
  const pointers = new Map();

  function showPreview() {
    const url = remove.checked ? null : pendingUrl ?? existingUrl;
    preview.hidden = !url;
    if (url) { previewImage.src = url; previewLabel.textContent = t(pendingUrl ? 'previewNew' : 'previewCurrent'); }
    else previewImage.removeAttribute('src');
  }
  function clearPending() {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    pending = null; pendingUrl = null;
  }
  function releaseSource() {
    source?.image.remove(); source?.release(); source = null; crop = null;
    pointers.clear(); gestureStart = null; input.value = '';
  }
  function reset(existing = null) {
    generation++;
    if (cropDialog.open) cropDialog.close();
    releaseSource(); clearPending(); existingUrl = existing; showPreview();
  }
  function renderCrop() {
    if (!source || !crop) return;
    const size = viewport.clientWidth;
    if (!size) return;
    const layout = cropLayout(crop, size);
    Object.assign(source.image.style, {
      width: `${layout.width}px`, height: `${layout.height}px`,
      left: `${layout.left}px`, top: `${layout.top}px`,
    });
    slider.value = String(crop.zoom);
  }
  async function selectImage() {
    const file = input.files[0]; if (!file) return;
    const token = ++generation;
    error.hidden = true;
    try {
      const loaded = await loadAvatarSource(file);
      if (token !== generation || !personDialog.open) { loaded.release(); return; }
      releaseSource(); source = loaded;
      source.image.className = 'crop-image'; source.image.alt = '';
      viewport.insertBefore(source.image, viewport.firstChild);
      crop = initialCrop(source.width, source.height);
      cropError.hidden = true;
      cropDialog.showModal(); renderCrop();
    } catch (failure) {
      if (token === generation) { input.value = ''; error.textContent = errorText(failure); error.hidden = false; }
    }
  }
  function startGesture() {
    if (!crop) return;
    gestureStart = { crop, points: [...pointers.values()].slice(0, 2).map((point) => ({ ...point })) };
  }
  function localPoint(event) {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  viewport.addEventListener('pointerdown', (event) => {
    if (!crop) return;
    event.preventDefault();
    try { viewport.setPointerCapture(event.pointerId); } catch { /* 古いWebKitでは捕捉不可でも移動は続けられる。 */ }
    pointers.set(event.pointerId, localPoint(event)); startGesture();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gestureStart) return;
    event.preventDefault(); pointers.set(event.pointerId, localPoint(event));
    crop = gestureCrop(gestureStart.crop, gestureStart.points,
      [...pointers.values()].slice(0, 2), viewport.clientWidth);
    renderCrop();
  });
  for (const eventName of ['pointerup', 'pointercancel']) viewport.addEventListener(eventName, (event) => {
    pointers.delete(event.pointerId); startGesture();
  });
  viewport.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[event.key];
    if (!crop || !step) return;
    event.preventDefault();
    crop = gestureCrop(crop, [{ x: 0, y: 0 }], [{ x: step[0], y: step[1] }], viewport.clientWidth);
    renderCrop();
  });
  slider.addEventListener('input', () => { if (crop) { crop = zoomCrop(crop, Number(slider.value)); renderCrop(); } });
  window.addEventListener('resize', renderCrop);
  input.addEventListener('change', selectImage);
  remove.addEventListener('change', () => {
    if (remove.checked) { clearPending(); input.value = ''; }
    showPreview();
  });
  confirm.addEventListener('click', async () => {
    if (!source || !crop || saving) return;
    const current = source;
    saving = true; confirm.disabled = true; cancel.disabled = true; close.disabled = true;
    cropError.hidden = true;
    try {
      const blob = await cropAvatar(current, cropRect(crop));
      if (source !== current) return;
      clearPending(); pending = blob; pendingUrl = URL.createObjectURL(blob);
      remove.checked = false; showPreview(); cropDialog.close();
    } catch (failure) { cropError.textContent = errorText(failure); cropError.hidden = false; }
    finally { saving = false; confirm.disabled = false; cancel.disabled = false; close.disabled = false; }
  });
  cropDialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  cropDialog.addEventListener('close', releaseSource);
  cancel.addEventListener('click', () => cropDialog.close());
  close.addEventListener('click', () => cropDialog.close());
  personDialog.addEventListener('close', () => reset());
  return { reset, imageForSave: () => pending, refreshLanguage: showPreview };
}
