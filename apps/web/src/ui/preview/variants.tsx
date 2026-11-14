// Cada variante de la vista previa es un componente con su propio estado local simulado,
// para poder probar a mano la hoja, los votos, los ajustes y el chat sin servidor.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  MESSAGE_MAX_LENGTH,
  type Answers,
  type ErrorCode,
  type GameSettings,
  type Player,
  type ReviewGroup,
  type RoomState,
} from '@bach/shared';
import { messageToFeedItem } from '../lib/feed';
import { GameEndScreen } from '../screens/GameEndScreen';
import { GameScreen } from '../screens/GameScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LobbyScreen } from '../screens/LobbyScreen';
import type { FeedItem, SoundControl } from '../types';
import {
  ANSWERS_COMPLETE,
  ANSWERS_PARTIAL,
  LETTER,
  makeAloneGroups,
  makeFeed,
  makeLetterRoom,
  makeLobbyRoom,
  makeRanking,
  makeReviewGroups,
  makeReviewRoom,
  makeRoundEndRoom,
  makeWritingRoom,
  rescore,
} from './fixtures';

export type PreviewVariant = {
  id: string;
  label: string;
  render: (log: (event: string) => void) => ReactNode;
};

/** Botón de sonido simulado: solo cambia de estado, no suena nada. */
function useSimulatedSound(): SoundControl {
  const [muted, setMuted] = useState(false);
  return { muted, onToggle: () => setMuted((m) => !m) };
}

/** Mensajes simulados: lo que escribes aparece en la lista. */
function useSimulatedFeed(initial: () => FeedItem[], room: RoomState, log: (e: string) => void) {
  const [feed, setFeed] = useState<FeedItem[]>(initial);
  const send = useCallback(
    (text: string) => {
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      log(`message:send "${text.slice(0, MESSAGE_MAX_LENGTH)}"`);
      setFeed((f) => [
        ...f,
        messageToFeedItem({ playerId: room.selfId, text }, room.players, room.selfId, id),
      ]);
    },
    [room.selfId, room.players, log],
  );
  return { feed, send };
}

function HomeVariant({
  log,
  error,
  inviteCode,
}: {
  log: (e: string) => void;
  error?: ErrorCode;
  inviteCode?: string;
}) {
  const [currentError, setError] = useState<ErrorCode | null>(error ?? null);
  return (
    <HomeScreen
      initialName=""
      inviteCode={inviteCode ?? null}
      error={currentError}
      onDismissError={() => setError(null)}
      connected
      onlineCount={12}
      onCreateRoom={(name) => log(`room:create name="${name}"`)}
      onJoinRoom={(code, name) => log(`room:join code=${code} name="${name}"`)}
    />
  );
}

function LobbyVariant({
  log,
  asGuest,
  crowd,
  solo,
  connected = true,
}: {
  log: (e: string) => void;
  asGuest?: boolean;
  crowd?: boolean;
  solo?: boolean;
  connected?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const [settings, setSettings] = useState<GameSettings>({ rounds: 5, writeSeconds: 90 });
  const [error, setError] = useState<ErrorCode | null>(null);
  const sound = useSimulatedSound();
  const room = { ...makeLobbyRoom(now, { selfId: asGuest ? 'p2' : 'p1', crowd, solo }), settings };
  const { feed, send } = useSimulatedFeed(
    () => makeFeed(room.players, room.selfId, 'lobby'),
    room,
    log,
  );
  return (
    <LobbyScreen
      room={room}
      feed={feed}
      connected={connected}
      sound={sound}
      error={error}
      onDismissError={() => setError(null)}
      onChangeSettings={(s) => {
        log(`room:settings rounds=${s.rounds} writeSeconds=${s.writeSeconds}`);
        setSettings(s);
      }}
      onStart={() => {
        log('game:start');
        setError('not_enough_players');
      }}
      onSendMessage={send}
      onLeave={() => log('leave')}
    />
  );
}

/** Callbacks de juego que solo registran lo que pasaría. */
function useGameLog(log: (e: string) => void) {
  return {
    onStopLetter: () => log('letter:stop'),
    onAnswerChange: (category: string, text: string) => log(`answers:update ${category}="${text}"`),
    onStop: () => log('round:stop'),
    onVote: (key: string, reject: boolean) => log(`review:vote key=${key} reject=${reject}`),
    onReady: (ready: boolean) => log(`review:ready ${ready}`),
    onSendMessage: (text: string) => log(`message:send "${text}"`),
    onLeave: () => log('leave'),
  };
}

/**
 * Ruleta de letras. `picker`: quien mira la detiene con el botón; `other`: se detiene sola tras
 * unos segundos (como si la detuviera Cami); `revealed`: letra ya revelada con 3-2-1 en bucle.
 * Tras revelarse vuelve a girar para poder verlo de nuevo.
 */
function LetterVariant({
  log,
  mode,
  connected = true,
}: {
  log: (e: string) => void;
  mode: 'picker' | 'other' | 'revealed';
  connected?: boolean;
}) {
  const [revealed, setRevealed] = useState(mode === 'revealed');
  const [endsAt, setEndsAt] = useState(() => Date.now() + (mode === 'revealed' ? 3000 : 8000));
  const [now] = useState(() => Date.now());
  const sound = useSimulatedSound();
  const game = useGameLog(log);

  const reveal = useCallback(() => {
    setRevealed(true);
    setEndsAt(Date.now() + 3000);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (revealed) {
      timer = setTimeout(() => {
        if (mode === 'revealed') {
          setEndsAt(Date.now() + 3000);
        } else {
          setRevealed(false);
          setEndsAt(Date.now() + 8000);
        }
      }, 4200);
    } else if (mode === 'other') {
      timer = setTimeout(reveal, 3500);
    }
    return () => clearTimeout(timer);
  }, [revealed, mode, endsAt, reveal]);

  const room = makeLetterRoom(now, {
    pickerIsSelf: mode === 'picker',
    letter: revealed ? LETTER : null,
    endsInMs: 0,
  });
  return (
    <GameScreen
      room={{ ...room, endsAt, serverNow: now }}
      feed={[]}
      connected={connected}
      serverOffsetMs={0}
      sound={sound}
      {...game}
      onStopLetter={() => {
        log('letter:stop');
        reveal();
      }}
    />
  );
}

function WritingVariant({
  log,
  answers = {},
  spectator,
  crowd,
  secondsLeft,
  stopped,
  connected = true,
}: {
  log: (e: string) => void;
  answers?: Answers;
  spectator?: boolean;
  crowd?: boolean;
  secondsLeft?: number;
  stopped?: { by: string | null };
  connected?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const [closed, setClosed] = useState<{ by: string | null } | null>(stopped ?? null);
  const sound = useSimulatedSound();
  const game = useGameLog(log);
  const room = makeWritingRoom(now, { answers, spectator, crowd, secondsLeft, stopped: closed });
  return (
    <GameScreen
      room={room}
      feed={[]}
      connected={connected}
      serverOffsetMs={0}
      sound={sound}
      {...game}
      onStop={() => {
        log('round:stop');
        setClosed({ by: room.selfId });
      }}
    />
  );
}

function ReviewVariant({
  log,
  view,
  crowd,
  category,
  initialGroups,
  readyIds,
  connected = true,
}: {
  log: (e: string) => void;
  view: 'author' | 'voter' | 'spectator';
  crowd?: boolean;
  category?: 'fruta' | 'animal';
  initialGroups?: ReviewGroup[];
  readyIds?: string[];
  connected?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const sound = useSimulatedSound();
  const game = useGameLog(log);
  const base = makeReviewRoom(now, { view, crowd, category, groups: initialGroups, readyIds });
  const [groups, setGroups] = useState<ReviewGroup[]>(base.review?.groups ?? []);
  const [ready, setReady] = useState<string[]>(readyIds ?? ['p3']);
  const players: Player[] = base.players.map((p) => ({ ...p, ready: ready.includes(p.id) }));
  const room: RoomState = {
    ...base,
    players,
    review: base.review ? { ...base.review, groups } : null,
  };
  const { feed, send } = useSimulatedFeed(
    () => makeFeed(room.players, room.selfId, 'review'),
    room,
    log,
  );
  return (
    <GameScreen
      room={room}
      feed={feed}
      connected={connected}
      serverOffsetMs={0}
      sound={sound}
      {...game}
      onVote={(key, reject) => {
        log(`review:vote key=${key} reject=${reject}`);
        setGroups((current) =>
          rescore(
            current.map((g) =>
              g.key === key
                ? {
                    ...g,
                    rejectedBy: reject
                      ? [...g.rejectedBy.filter((id) => id !== room.selfId), room.selfId]
                      : g.rejectedBy.filter((id) => id !== room.selfId),
                  }
                : g,
            ),
            players,
          ),
        );
      }}
      onReady={(value) => {
        log(`review:ready ${value}`);
        setReady((r) => (value ? [...r, room.selfId] : r.filter((id) => id !== room.selfId)));
      }}
      onSendMessage={send}
    />
  );
}

function RoundEndVariant({
  log,
  last,
  crowd,
  timeUp,
}: {
  log: (e: string) => void;
  last?: boolean;
  crowd?: boolean;
  timeUp?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const sound = useSimulatedSound();
  const game = useGameLog(log);
  const room = makeRoundEndRoom(now, { last, crowd, timeUp });
  const { feed, send } = useSimulatedFeed(
    () => makeFeed(room.players, room.selfId, 'review'),
    room,
    log,
  );
  return (
    <GameScreen
      room={room}
      feed={feed}
      connected
      serverOffsetMs={0}
      sound={sound}
      {...game}
      onSendMessage={send}
    />
  );
}

function EndVariant({
  log,
  asGuest,
  tie,
  crowd,
}: {
  log: (e: string) => void;
  asGuest?: boolean;
  tie?: boolean;
  crowd?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const sound = useSimulatedSound();
  const ranking = makeRanking({ tie, crowd });
  const players = makeLobbyRoom(now, { crowd }).players;
  const room = makeLobbyRoom(now, { selfId: asGuest ? 'p3' : 'p1', crowd });
  const { feed, send } = useSimulatedFeed(() => makeFeed(players, room.selfId, 'lobby'), room, log);
  return (
    <GameEndScreen
      ranking={ranking}
      selfId={asGuest ? 'p3' : 'p1'}
      hostId="p1"
      connected
      sound={sound}
      feed={feed}
      onSendMessage={send}
      onPlayAgain={() => log('play again')}
      onLeave={() => log('leave')}
    />
  );
}

export const VARIANTS: PreviewVariant[] = [
  { id: 'home', label: 'Inicio', render: (log) => <HomeVariant log={log} /> },
  {
    id: 'home-error',
    label: 'Inicio con error',
    render: (log) => <HomeVariant log={log} error="room_not_found" />,
  },
  {
    id: 'home-invite',
    label: 'Inicio por enlace',
    render: (log) => <HomeVariant log={log} inviteCode="KQXM" />,
  },
  {
    id: 'lobby-host',
    label: 'Sala de espera: anfitrión',
    render: (log) => <LobbyVariant log={log} />,
  },
  {
    id: 'lobby-guest',
    label: 'Sala de espera: invitado',
    render: (log) => <LobbyVariant log={log} asGuest />,
  },
  {
    id: 'lobby-solo',
    label: 'Sala de espera: 1 jugador',
    render: (log) => <LobbyVariant log={log} solo />,
  },
  {
    id: 'lobby-crowd',
    label: 'Sala de espera: 12 jugadores',
    render: (log) => <LobbyVariant log={log} crowd />,
  },
  {
    id: 'letter-picker',
    label: 'Letra girando: te toca (ciclo completo)',
    render: (log) => <LetterVariant log={log} mode="picker" />,
  },
  {
    id: 'letter-other',
    label: 'Letra girando: le toca a Cami (ciclo completo)',
    render: (log) => <LetterVariant log={log} mode="other" />,
  },
  {
    id: 'letter-revealed',
    label: 'Letra revelada: ¡Con la F! 3-2-1',
    render: (log) => <LetterVariant log={log} mode="revealed" />,
  },
  {
    id: 'writing-empty',
    label: 'Escribiendo: hoja vacía',
    render: (log) => <WritingVariant log={log} />,
  },
  {
    id: 'writing-partial',
    label: 'Escribiendo: a medias (una con otra letra)',
    render: (log) => <WritingVariant log={log} answers={ANSWERS_PARTIAL} />,
  },
  {
    id: 'writing-complete',
    label: 'Escribiendo: hoja completa (STOP habilitado)',
    render: (log) => <WritingVariant log={log} answers={ANSWERS_COMPLETE} />,
  },
  {
    id: 'writing-urgent',
    label: 'Escribiendo: últimos segundos',
    render: (log) => <WritingVariant log={log} answers={ANSWERS_PARTIAL} secondsLeft={8} />,
  },
  {
    id: 'writing-stopped',
    label: 'Escribiendo: STOP de Cami',
    render: (log) => <WritingVariant log={log} answers={ANSWERS_PARTIAL} stopped={{ by: 'p2' }} />,
  },
  {
    id: 'writing-stopped-self',
    label: 'Escribiendo: STOP tuyo',
    render: (log) => <WritingVariant log={log} answers={ANSWERS_COMPLETE} stopped={{ by: 'p1' }} />,
  },
  {
    id: 'writing-timeup',
    label: 'Escribiendo: se acabó el tiempo',
    render: (log) => (
      <WritingVariant log={log} answers={ANSWERS_PARTIAL} stopped={{ by: null }} secondsLeft={0} />
    ),
  },
  {
    id: 'writing-spectator',
    label: 'Escribiendo: espectador (entró tarde)',
    render: (log) => <WritingVariant log={log} spectator />,
  },
  {
    id: 'writing-crowd',
    label: 'Escribiendo: 12 jugadores',
    render: (log) => <WritingVariant log={log} answers={ANSWERS_PARTIAL} crowd />,
  },
  {
    id: 'writing-disconnected',
    label: 'Escribiendo: sin conexión',
    render: (log) => <WritingVariant log={log} answers={ANSWERS_COMPLETE} connected={false} />,
  },
  {
    id: 'review-author',
    label: 'Revisión: eres autor (50/100/anulada/rechazada)',
    render: (log) => <ReviewVariant log={log} view="author" />,
  },
  {
    id: 'review-voter',
    label: 'Revisión: votas tú (Cami)',
    render: (log) => <ReviewVariant log={log} view="voter" readyIds={['p3', 'p4']} />,
  },
  {
    id: 'review-alone',
    label: 'Revisión: único válido (200)',
    render: (log) => (
      <ReviewVariant log={log} view="author" category="animal" initialGroups={makeAloneGroups()} />
    ),
  },
  {
    id: 'review-empty',
    label: 'Revisión: nadie escribió',
    render: (log) => <ReviewVariant log={log} view="author" initialGroups={[]} />,
  },
  {
    id: 'review-spectator',
    label: 'Revisión: espectador (solo mira)',
    render: (log) => <ReviewVariant log={log} view="spectator" />,
  },
  {
    id: 'review-crowd',
    label: 'Revisión: 12 jugadores',
    render: (log) => (
      <ReviewVariant
        log={log}
        view="author"
        crowd
        initialGroups={makeReviewGroups()}
        readyIds={['p3', 'p4', 'p6', 'p9']}
      />
    ),
  },
  {
    id: 'review-disconnected',
    label: 'Revisión: sin conexión',
    render: (log) => <ReviewVariant log={log} view="voter" connected={false} />,
  },
  {
    id: 'round-end',
    label: 'Fin de ronda',
    render: (log) => <RoundEndVariant log={log} />,
  },
  {
    id: 'round-end-last',
    label: 'Fin de ronda: la última (tiempo agotado)',
    render: (log) => <RoundEndVariant log={log} last timeUp />,
  },
  {
    id: 'round-end-crowd',
    label: 'Fin de ronda: 12 jugadores',
    render: (log) => <RoundEndVariant log={log} crowd />,
  },
  { id: 'game-end', label: 'Podio: anfitrión', render: (log) => <EndVariant log={log} /> },
  {
    id: 'game-end-guest-tie',
    label: 'Podio: invitado con empate',
    render: (log) => <EndVariant log={log} asGuest tie />,
  },
  {
    id: 'game-end-crowd',
    label: 'Podio: 12 jugadores',
    render: (log) => <EndVariant log={log} crowd />,
  },
  {
    id: 'disconnected-lobby',
    label: 'Sala de espera sin conexión',
    render: (log) => <LobbyVariant log={log} connected={false} />,
  },
];
