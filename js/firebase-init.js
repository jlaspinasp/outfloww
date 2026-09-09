/* =====================================================
   FIREBASE INIT
   Loaded before app.js. Exposes `auth` and `db` globals
   used by app.js to sign in and sync data to Firestore.
   ===================================================== */

const firebaseConfig = {
    apiKey: "AIzaSyBSMrhOKqIGT_zzBbSNrH5C_Df0zV9wawY",
    authDomain: "outfloww-c0eb4.firebaseapp.com",
    projectId: "outfloww-c0eb4",
    storageBucket: "outfloww-c0eb4.firebasestorage.app",
    messagingSenderId: "1026652402344",
    appId: "1:1026652402344:web:a43cdd29022d63a19b089d",
    measurementId: "G-W85WTPSJRJ"
};

firebase.initializeApp(firebaseConfig);

// Keep you signed in across restarts on this device/browser.
firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

const auth = firebase.auth();
const db = firebase.firestore();