// Une los sonidos con el estado: arranca el desbloqueo del audio y los relojes de sonido. Los
// efectos de eventos del servidor los dispara `client.ts` con `soundForEvent` (ver `sound/triggers.ts`).

import { secondsRemaining } from '../ui/lib/clock';
import {
  installAudioUnlock,
  isRouletteSpinning,
  nextTick,
  playSound,
  type TickState,
} from '../sound';
import { useGameStore } from './store';

/** Igual que `useCountdown`: se recalcula desde la hora absoluta, así no se desfasa. */
const TICK_POLL_MS = 200;
/** La ruleta cambia de letra cada 70 ms; el clic suena cada dos letras. */
const ROULETTE_TICK_MS = 140;

/** Una sola vez: oyentes de desbloqueo del audio y relojes (tics de los últimos segundos y de la ruleta). */
export function startSoundDriver(): void {
  installAudioUnlock();

  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let rouletteTimer: ReturnType<typeof setInterval> | null = null;
  let tickState: TickState = { last: null };

  const pollCountdown = () => {
    const { room, serverOffsetMs } = useGameStore.getState().session;
    const seconds =
      room?.endsAt == null ? null : secondsRemaining(room.endsAt, serverOffsetMs, Date.now());
    const step = nextTick(room?.phase ?? null, seconds, tickState, room?.stopped != null);
    tickState = step.state;
    // En segundo plano el reloj sigue pero no se oye: así no se acumulan tics al volver.
    if (step.play && document.visibilityState === 'visible') playSound('tick');
  };

  const pollRoulette = () => {
    if (document.visibilityState === 'visible') playSound('rouletteTick');
  };

  const sync = () => {
    const room = useGameStore.getState().session.room;

    const writing = room?.phase === 'WRITING' && room.stopped === null;
    if (writing && countdownTimer === null) {
      tickState = { last: null };
      countdownTimer = setInterval(pollCountdown, TICK_POLL_MS);
      pollCountdown();
    } else if (!writing && countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      tickState = { last: null };
    }

    const spinning = isRouletteSpinning(room);
    if (spinning && rouletteTimer === null) {
      rouletteTimer = setInterval(pollRoulette, ROULETTE_TICK_MS);
    } else if (!spinning && rouletteTimer !== null) {
      clearInterval(rouletteTimer);
      rouletteTimer = null;
    }
  };

  useGameStore.subscribe(sync);
  sync();
}
