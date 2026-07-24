import { useRef, useState } from 'react';

// A secret starts masked and stays masked until the user acts. A quick tap/click toggles a
// sticky reveal; pressing and holding past HOLD_THRESHOLD_MS reveals only while held, and
// re-masks the instant it's released. Never revealed as a side effect of anything else (mount,
// re-render, parent state change) - only these two direct user gestures can reveal it.
const HOLD_THRESHOLD_MS = 350;

export function useHoldReveal() {
    const [revealed, setRevealed] = useState(false);
    const pressStartedAt = useRef(null);
    const wasHold = useRef(false);

    function handlePointerDown() {
        pressStartedAt.current = Date.now();
        wasHold.current = false;
        const timer = setTimeout(() => {
            wasHold.current = true;
            setRevealed(true);
        }, HOLD_THRESHOLD_MS);
        pressStartedAt.current = timer;
    }

    function handlePointerUp() {
        clearTimeout(pressStartedAt.current);
        if (wasHold.current) {
            setRevealed(false);
        } else {
            setRevealed((r) => !r);
        }
    }

    function handlePointerLeave() {
        if (wasHold.current) {
            clearTimeout(pressStartedAt.current);
            setRevealed(false);
        }
    }

    return {
        revealed,
        bind: {
            onPointerDown: handlePointerDown,
            onPointerUp: handlePointerUp,
            onPointerLeave: handlePointerLeave,
        },
    };
}
