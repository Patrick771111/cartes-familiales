// Stub minimal de `supabase` : couvre juste ce que webrtc/relay.js utilise
// (channel/broadcast/subscribe/removeChannel), en résolvant immédiatement —
// pas de vraie signalisation WebRTC nécessaire pour tester en solo/scripté.
function fakeChannel() {
  const ch = {
    on() { return ch; },
    subscribe(cb) {
      if (cb) queueMicrotask(() => cb('SUBSCRIBED'));
      return ch;
    },
    send() { return Promise.resolve('ok'); }
  };
  return ch;
}

export const supabase = {
  channel: () => fakeChannel(),
  removeChannel: () => {}
};
