// Öffentliche URL der über EAS Hosting deployten Web-Version – für
// Einladungslinks (club-settings.tsx), die den Einladungscode direkt
// vorausfüllen. Muss nach einem Wechsel der Hosting-Domain hier
// angepasst werden.
export const WEB_APP_URL = 'https://kegelclub.expo.app';

// AsyncStorage-Key, unter dem join-club.tsx einen Einladungscode
// zwischenspeichert, wenn ein Einladungslink ohne aktive Session
// geöffnet wird – login.tsx liest ihn nach erfolgreicher Anmeldung/
// Registrierung wieder aus, damit der Code den Umweg über den
// Login-Screen übersteht.
export const PENDING_INVITE_CODE_KEY = 'pendingInviteCode';
