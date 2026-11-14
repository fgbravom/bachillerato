import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { Answers, CategoryId, Phase, Player, RoomState } from '@bach/shared';
import { ClockBadge } from '../components/ClockBadge';
import { LogoutIcon } from '../components/icons';
import { LetterSticker } from '../components/LetterSticker';
import { LetterStage } from '../components/LetterStage';
import { MessageComposer } from '../components/MessageComposer';
import { MessageFeed } from '../components/MessageFeed';
import { PlayerList } from '../components/PlayerList';
import { ReconnectBanner } from '../components/ReconnectBanner';
import { ReviewPanel } from '../components/ReviewPanel';
import { RoundEndPanel } from '../components/RoundEndPanel';
import { SoundToggle } from '../components/SoundToggle';
import { StopBar } from '../components/StopBar';
import { StopOverlay } from '../components/StopOverlay';
import { WaitingPanel } from '../components/WaitingPanel';
import { WritingSheet } from '../components/WritingSheet';
import { useCountdown } from '../hooks/useCountdown';
import { DESK_QUERY, LAND_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { phaseAnnouncement } from '../lib/announce';
import { countFilled, sheetProgress } from '../lib/sheet';
import type { FeedItem, SoundControl } from '../types';

export type GameScreenProps = {
  /** Foto de la sala en fase LETTER, WRITING, REVIEW o ROUND_END. */
  room: RoomState;
  /** Mensajes del chat (solo se muestran en REVIEW y ROUND_END). */
  feed: readonly FeedItem[];
  /** `false` muestra el aviso de reconexión y bloquea chat, votos y STOP. */
  connected: boolean;
  /** `serverNow - Date.now()` medido al recibir `room:state` (ver `computeServerOffset`). */
  serverOffsetMs: number;
  /** Botón de silenciar; si no se pasa, no se muestra. */
  sound?: SoundControl;
  /** Solo `pickerId`: detiene la ruleta de letras (`letter:stop`). */
  onStopLetter: () => void;
  /**
   * Cambió el texto de una categoría (en cada tecla, sin retardo: el envío con retardo ≤ 300 ms
   * lo pone quien conecta). La pantalla guarda lo que se escribe y parte de `room.myAnswers`.
   */
  onAnswerChange: (category: CategoryId, text: string) => void;
  /** Se gritó STOP con la hoja completa (`round:stop`). */
  onStop: () => void;
  /** Marca (`reject: true`) o desmarca "No vale" en el grupo `key` (`review:vote`). */
  onVote: (key: string, reject: boolean) => void;
  /** Marca o desmarca "Listo" en la categoría en revisión (`review:ready`). */
  onReady: (ready: boolean) => void;
  onSendMessage: (text: string) => void;
  /** Si se pasa, aparece el botón "Salir". La confirmación (si la hay) es cosa de quien lo conecta. */
  onLeave?: () => void;
};

type HeaderProps = {
  letter: string | null;
  label: string;
  title: ReactNode;
  round: number;
  totalRounds: number;
  seconds: number | null;
  urgent: boolean;
  /** Poco alto disponible (teclado abierto, teléfono apaisado): se suelta la etiqueta pequeña. */
  compact: boolean;
};

function GameHeader({
  letter,
  label,
  title,
  round,
  totalRounds,
  seconds,
  urgent,
  compact,
}: HeaderProps) {
  return (
    <header
      data-testid="game-header"
      className={`flex shrink-0 items-center gap-2 border-b-2 border-ink bg-card px-3 land:min-h-0 land:pb-1 land:pt-[max(0.25rem,env(safe-area-inset-top))] desk:gap-4 desk:px-4 ${
        compact
          ? 'min-h-0 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))]'
          : 'min-h-[3.75rem] pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]'
      }`}
    >
      <ClockBadge seconds={seconds} urgent={urgent} />
      <LetterSticker letter={letter} size={compact ? 'sm' : 'md'} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span
          className={`text-[0.7rem] font-extrabold tracking-wide text-ink-soft uppercase sm:text-xs ${compact ? 'hidden desk:block' : ''}`}
        >
          {label}
        </span>
        <span
          data-testid="header-title"
          className="line-clamp-2 text-sm font-black sm:text-lg desk:text-xl"
        >
          {title}
        </span>
      </div>
      <div
        data-testid="round-chip"
        className="flex shrink-0 flex-col items-center rounded-xl border-2 border-ink bg-mar-soft px-2 py-0.5 leading-tight"
      >
        <span className="text-[0.65rem] font-extrabold tracking-wide text-ink-soft uppercase">
          Ronda
        </span>
        <span className="text-sm font-black tabular-nums">
          {round}/{totalRounds}
        </span>
      </div>
    </header>
  );
}

/** Sin menú contextual al mantener presionado (táctil), salvo en campos de texto y mensajes. */
function suppressLongPressMenu(event: MouseEvent<HTMLElement>): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, [data-selectable]'))
    return;
  event.preventDefault();
}

type ChipsBarProps = {
  players: readonly Player[];
  selfId: string;
  pickerId: string | null;
  phase: Phase;
  totalCategories: number;
  sound?: SoundControl;
  onLeave?: () => void;
  /** En escritorio las fichas pasan a la línea de abajo en vez de desplazarse de lado. */
  wrap: boolean;
  className?: string;
};

/** Fila compacta de fichas de jugadores, con silenciar y salir al costado. */
function ChipsBar({
  players,
  selfId,
  pickerId,
  phase,
  totalCategories,
  sound,
  onLeave,
  wrap,
  className = '',
}: ChipsBarProps) {
  return (
    <div
      className={`flex shrink-0 items-center border-b-2 border-ink bg-paper-deep ${wrap ? 'items-start py-1' : ''} ${className}`}
    >
      <PlayerList
        players={players}
        selfId={selfId}
        pickerId={pickerId}
        phase={phase}
        totalCategories={totalCategories}
        variant="chips"
        wrap={wrap}
        className="min-w-0 flex-1"
      />
      <div className="mr-2 flex shrink-0 items-center gap-1">
        {sound && <SoundToggle muted={sound.muted} onToggle={sound.onToggle} />}
        {onLeave && (
          <button
            type="button"
            onClick={onLeave}
            aria-label="Salir de la sala"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border-2 border-ink bg-card"
          >
            <LogoutIcon />
          </button>
        )}
      </div>
    </div>
  );
}

export function GameScreen({
  room,
  feed,
  connected,
  serverOffsetMs,
  sound,
  onStopLetter,
  onAnswerChange,
  onStop,
  onVote,
  onReady,
  onSendMessage,
  onLeave,
}: GameScreenProps) {
  const { compact, keyboardOpen, height: viewportHeight } = useVisualViewport();
  const landscape = useMediaQuery(LAND_QUERY);
  const desk = useMediaQuery(DESK_QUERY);
  const { seconds, urgent } = useCountdown(room.endsAt, serverOffsetMs);

  // Mientras se juega, la página no se desplaza ni rebota: todo cabe en la pantalla.
  useEffect(() => {
    document.documentElement.classList.add('game-lock');
    return () => document.documentElement.classList.remove('game-lock');
  }, []);

  const { phase } = room;
  const categoryIds = useMemo(() => room.categories.map((c) => c.id), [room.categories]);
  const total = categoryIds.length;
  const letter = room.letter ?? '';
  const self = room.players.find((p) => p.id === room.selfId);
  const playing = self?.playing ?? false;
  const picker = room.players.find((p) => p.id === room.pickerId);
  const pickerName = picker?.name ?? 'Alguien';
  const isPicker = room.selfId === room.pickerId;

  // Lo que lleva escrito quien mira: lo del servidor (al reconectar) más lo tecleado en esta ronda.
  const [typed, setTyped] = useState<{ round: number; answers: Answers }>({
    round: room.round,
    answers: {},
  });
  const answers: Answers = useMemo(
    () => ({ ...room.myAnswers, ...(typed.round === room.round ? typed.answers : {}) }),
    [room.myAnswers, room.round, typed],
  );
  const changeAnswer = (category: CategoryId, text: string) => {
    setTyped((prev) => ({
      round: room.round,
      answers: { ...(prev.round === room.round ? prev.answers : {}), [category]: text },
    }));
    onAnswerChange(category, text);
  };

  const progress = sheetProgress(answers, categoryIds, letter);
  // Mi avance se ve al instante; el de los demás llega del servidor.
  const players = useMemo(
    () =>
      phase === 'WRITING' && playing
        ? room.players.map((p) =>
            p.id === room.selfId ? { ...p, filled: countFilled(answers, categoryIds) } : p,
          )
        : room.players,
    [phase, playing, room.players, room.selfId, answers, categoryIds],
  );

  const review = room.review;
  const reviewLabel = review
    ? (room.categories.find((c) => c.id === review.category)?.label ?? null)
    : null;
  const stopped = phase === 'WRITING' ? room.stopped : null;
  const stoppedByName = stopped?.by
    ? (room.players.find((p) => p.id === stopped.by)?.name ?? 'Alguien')
    : null;

  // Teléfono vertical con el teclado abierto (o muy poco alto): se sueltan adornos para que
  // quepan la hoja, el último mensaje y el campo de texto.
  const squeezed = !landscape && !desk && (keyboardOpen || compact);
  // Apaisado con teclado: no caben ni las fichas de jugadores.
  const tooShort = landscape && viewportHeight !== null && viewportHeight < 300;
  const hideChips = squeezed || tooShort;
  const compactHeader = squeezed || landscape;

  const announcement = phaseAnnouncement({
    phase,
    round: room.round,
    totalRounds: room.totalRounds,
    letter: room.letter,
    isPicker,
    pickerName,
    playing,
    reviewLabel,
    reviewIndex: review?.index ?? 0,
    reviewTotal: review?.total ?? total,
  });

  // --- Cabecera según la fase ---------------------------------------------
  let headerLabel = '';
  let headerTitle: ReactNode = '';
  if (phase === 'LETTER') {
    headerLabel = room.letter ? 'Salió la letra' : 'Sale la letra';
    headerTitle = room.letter
      ? `¡Con la ${room.letter}!`
      : isPicker
        ? 'Te toca detenerla'
        : `Le toca a ${pickerName}`;
  } else if (phase === 'WRITING') {
    const done = players.filter((p) => p.playing && p.filled >= total).length;
    const playingCount = players.filter((p) => p.playing).length;
    headerLabel = playing ? 'Tu hoja' : 'Mirando';
    headerTitle = playing
      ? `${progress.filled} de ${total} categorías`
      : `${done} de ${playingCount} hojas completas`;
  } else if (phase === 'REVIEW') {
    headerLabel = review ? `Categoría ${review.index + 1} de ${review.total}` : 'Revisión';
    headerTitle = reviewLabel ?? 'Revisión';
    // Sin la etiqueta pequeña (cabecera compacta) el "4 de 7" pasa al título.
    if (review && compactHeader)
      headerTitle = `${reviewLabel ?? 'Revisión'} · ${review.index + 1}/${review.total}`;
  } else if (phase === 'ROUND_END') {
    headerLabel = 'Fin de la ronda';
    headerTitle =
      room.round < room.totalRounds ? 'Puntos de la ronda' : 'Puntos de la última ronda';
  }

  const chipsBar = (extra: { className?: string; wrap?: boolean } = {}) => (
    <ChipsBar
      players={players}
      selfId={room.selfId}
      pickerId={room.pickerId}
      phase={phase}
      totalCategories={total}
      sound={sound}
      onLeave={onLeave}
      wrap={extra.wrap ?? false}
      className={extra.className}
    />
  );

  const chatPhase = phase === 'REVIEW' || phase === 'ROUND_END';

  const stopBar = (
    <StopBar
      progress={progress}
      letter={letter}
      totalCategories={total}
      disabled={stopped !== null || !connected}
      keyboardOpen={keyboardOpen}
      compact={squeezed || landscape}
      onStop={onStop}
    />
  );

  return (
    <div
      data-testid="game-screen"
      data-phase={phase}
      onContextMenu={suppressLongPressMenu}
      className="fixed inset-x-0 top-[calc(var(--app-top)+var(--notice-h,0px))] flex h-[calc(var(--app-h)-var(--notice-h,0px))] select-none flex-col overflow-clip bg-paper pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
    >
      <ReconnectBanner connected={connected} />
      {/* Única voz de los cambios de fase para lectores de pantalla; el chat lo anuncia la lista. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <GameHeader
        letter={room.letter}
        label={headerLabel}
        title={headerTitle}
        round={room.round}
        totalRounds={room.totalRounds}
        seconds={seconds}
        urgent={urgent}
        compact={compactHeader}
      />

      {phase === 'LETTER' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {!hideChips && chipsBar({ wrap: desk })}
          <LetterStage
            key={room.round}
            letter={room.letter}
            isPicker={isPicker}
            pickerName={pickerName}
            secondsToStart={seconds}
            compact={squeezed || landscape}
            onStop={onStopLetter}
          />
        </div>
      )}

      {phase === 'WRITING' && (
        <div className="flex min-h-0 flex-1 flex-col land:flex-row">
          {!landscape && !hideChips && chipsBar({ wrap: desk })}
          {playing ? (
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  data-testid="writing-scroll"
                  className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 desk:px-4 desk:py-5"
                >
                  <div className="mx-auto w-full max-w-md land:max-w-3xl desk:max-w-6xl">
                    <WritingSheet
                      key={room.round}
                      categories={room.categories}
                      letter={letter}
                      answers={answers}
                      locked={stopped !== null}
                      layout={desk ? 'table' : 'stack'}
                      autoFocus={stopped === null}
                      viewportKey={viewportHeight}
                      onChange={changeAnswer}
                    />
                  </div>
                </div>
                {!landscape && stopBar}
              </div>
              {/* Apaisado: avance de los demás y botón ¡STOP! a la derecha, fuera del camino de la hoja. */}
              {landscape && (
                <aside className="flex w-52 shrink-0 flex-col border-l-2 border-ink bg-paper-deep">
                  {!hideChips && (
                    <>
                      <div className="flex shrink-0 items-center justify-end gap-1 px-2 py-1">
                        {sound && <SoundToggle muted={sound.muted} onToggle={sound.onToggle} />}
                        {onLeave && (
                          <button
                            type="button"
                            onClick={onLeave}
                            aria-label="Salir de la sala"
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border-2 border-ink bg-card"
                          >
                            <LogoutIcon />
                          </button>
                        )}
                      </div>
                      <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                        <PlayerList
                          players={players}
                          selfId={room.selfId}
                          pickerId={room.pickerId}
                          phase={phase}
                          totalCategories={total}
                          variant="column"
                        />
                      </div>
                    </>
                  )}
                  <div className="mt-auto">{stopBar}</div>
                </aside>
              )}
            </>
          ) : (
            <>
              <WaitingPanel
                letter={letter}
                doneCount={players.filter((p) => p.playing && p.filled >= total).length}
                playingCount={players.filter((p) => p.playing).length}
              />
              {landscape && (
                <div className="flex w-52 shrink-0 flex-col gap-1 border-l-2 border-ink bg-paper-deep p-2">
                  <PlayerList
                    players={players}
                    selfId={room.selfId}
                    pickerId={room.pickerId}
                    phase={phase}
                    totalCategories={total}
                    variant="column"
                    className="min-h-0 flex-1 overflow-y-auto"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {chatPhase && (
        <div className="flex min-h-0 flex-1 flex-col land:grid land:grid-cols-[minmax(0,1fr)_clamp(14rem,36vw,20rem)] land:grid-rows-[auto_minmax(0,1fr)] desk:grid desk:grid-cols-[17rem_minmax(0,1fr)_21rem] desk:grid-rows-[minmax(0,1fr)] desk:gap-4 desk:p-4">
          {/* Móvil: fila compacta de fichas (en apaisado, arriba de los mensajes). Se oculta con el teclado abierto. */}
          {!hideChips && (
            <div className="contents desk:hidden">
              {chipsBar({ className: 'land:col-start-2 land:row-start-1 land:border-l-2' })}
            </div>
          )}

          {/* Escritorio: jugadores a la izquierda. */}
          <aside className="hidden min-h-0 flex-col gap-3 desk:flex">
            <h2 className="text-lg font-black">Jugadores</h2>
            <div className="relative min-h-0 flex-1 overflow-y-auto pr-1">
              <PlayerList
                players={players}
                selfId={room.selfId}
                pickerId={null}
                phase={phase}
                totalCategories={total}
                variant="column"
              />
            </div>
            <div className="flex gap-2">
              {onLeave && (
                <button
                  type="button"
                  onClick={onLeave}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-ink bg-card px-4 font-extrabold shadow-pop-sm hover:bg-sol-soft"
                >
                  <LogoutIcon /> Salir de la sala
                </button>
              )}
              {sound && (
                <SoundToggle
                  muted={sound.muted}
                  onToggle={sound.onToggle}
                  className="shadow-pop-sm hover:bg-sol-soft"
                />
              )}
            </div>
          </aside>

          {/* Centro: tarjetas de revisión o tabla de fin de ronda. */}
          <main className="flex min-h-0 flex-1 flex-col land:col-start-1 land:row-span-2 land:row-start-1 desk:overflow-hidden desk:rounded-2xl desk:border-2 desk:border-ink desk:bg-paper-deep desk:shadow-pop">
            {phase === 'REVIEW' && review && (
              <ReviewPanel
                review={review}
                players={players}
                selfId={room.selfId}
                letter={letter}
                connected={connected}
                onVote={onVote}
                onReady={onReady}
              />
            )}
            {phase === 'ROUND_END' && room.roundEnd && (
              <RoundEndPanel
                roundEnd={room.roundEnd}
                players={players}
                categories={room.categories}
                selfId={room.selfId}
              />
            )}
          </main>

          {/* Derecha en escritorio y apaisado / abajo en móvil vertical: mensajes y campo de texto. */}
          <section
            aria-label="Mensajes"
            className={`flex shrink-0 flex-col border-t-2 border-ink land:col-start-2 land:row-start-2 land:min-h-0 land:border-t-0 land:border-l-2 land:border-ink land:bg-card desk:min-h-0 desk:overflow-hidden desk:rounded-2xl desk:border-2 desk:border-ink desk:bg-card desk:shadow-pop ${
              squeezed ? 'h-[6.5rem]' : 'h-[8.25rem]'
            } land:h-auto desk:h-auto`}
          >
            <MessageFeed items={feed} className="min-h-0 flex-1" />
            <MessageComposer
              onSend={onSendMessage}
              disabled={!connected}
              keyboardOpen={keyboardOpen}
              className="bg-paper land:bg-card desk:bg-card"
            />
          </section>
        </div>
      )}

      {stopped && <StopOverlay byName={stoppedByName} isSelf={stopped.by === room.selfId} />}
    </div>
  );
}
