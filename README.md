# SlideAir

Present with your hands. SlideAir turns your webcam into a presentation remote:
swipe to change slides and point at the screen to get a laser dot. A held open
palm arms and disarms everything so it never misfires while you talk with your
hands.

All processing runs on your device with Google MediaPipe hand tracking compiled
to WebAssembly. No account, no upload, no server.

## Gestures

| Gesture | Action |
|---|---|
| Open palm, hold | Arm or disarm gesture control |
| Swipe left | Next slide |
| Swipe right | Previous slide |
| Point at the screen | Laser dot follows your fingertip |

Keyboard works too: arrows navigate, F is fullscreen, B is blackout, H is help.

## Your own deck

Open the Deck menu and paste markdown. Slides are separated by `---` lines.
Inside a slide: `# heading`, `## kicker`, `- bullets`, `> big statement`.
Decks are saved in your browser only.

## Stack

React + Vite + TypeScript. MediaPipe Tasks Vision (self-hosted WASM + model).
Gesture logic is a pure state machine in `src/lib/gestures.ts` with unit tests.

## Develop

```bash
npm install
npm run dev
npm test
npm run build
```

Part of the Conductor project: motion as a first-class input.
