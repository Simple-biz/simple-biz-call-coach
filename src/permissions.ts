document.getElementById('grant')!.addEventListener('click', async () => {
  const status = document.getElementById('status')!;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    status.className = 'success';
    status.textContent = 'Microphone permission granted! You can close this tab.';
  } catch (e: any) {
    status.className = 'error';
    status.textContent = 'Permission denied: ' + e.message;
  }
});
