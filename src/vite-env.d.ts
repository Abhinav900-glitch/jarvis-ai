/// <reference types="vite/client" />

// The UI kit exports its stylesheet as a named subpath, which the generic
// `*.css` declaration from vite/client does not cover.
declare module "@cometchat/chat-uikit-react/styles";
