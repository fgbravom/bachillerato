import type { Phase, Player } from '@bach/shared';
import { rankByScore } from '../lib/ranking';
import { Avatar } from './Avatar';
import { BellIcon, CheckIcon, CrownIcon, EyeIcon } from './icons';

type PlayerListProps = {
  players: readonly Player[];
  selfId: string;
  /** A quién le toca detener la ruleta (fase LETTER); `null` si no hay. */
  pickerId: string | null;
  phase: Phase;
  /** Categorías de la hoja (para mostrar `3/7` en WRITING). */
  totalCategories: number;
  /**
   * `column`: lista vertical con puesto y puntaje (escritorio, partida).
   * `chips`: fila compacta que se desplaza de lado (móvil, partida).
   * `lobby`: lista vertical de la sala de espera, en orden de llegada y con anfitrión.
   */
  variant: 'column' | 'chips' | 'lobby';
  /** Solo `chips`: en vez de desplazarse de lado, las fichas pasan a la línea de abajo. */
  wrap?: boolean;
  className?: string;
};

type Status = {
  label: string;
  icon: 'bell' | 'check' | 'eye' | null;
  /** La ficha se destaca: hoja completa (WRITING), "Listo" (REVIEW) o quien detiene la letra. */
  tone: 'none' | 'picker' | 'done';
};

const NO_STATUS: Status = { label: '', icon: null, tone: 'none' };

function statusOf(player: Player, pickerId: string | null, phase: Phase, total: number): Status {
  if (!player.connected) return { label: 'sin conexión', icon: null, tone: 'none' };
  switch (phase) {
    case 'LETTER':
      if (player.id === pickerId) {
        return { label: 'detiene la letra', icon: 'bell', tone: 'picker' };
      }
      return NO_STATUS;
    case 'WRITING':
      if (!player.playing) return { label: 'mira esta ronda', icon: 'eye', tone: 'none' };
      if (total > 0 && player.filled >= total) {
        return { label: 'hoja completa', icon: 'check', tone: 'done' };
      }
      return NO_STATUS;
    case 'REVIEW':
      if (!player.playing) return { label: 'mira esta ronda', icon: 'eye', tone: 'none' };
      if (player.ready) return { label: 'listo', icon: 'check', tone: 'done' };
      return NO_STATUS;
    default:
      return NO_STATUS;
  }
}

function StatusBadge({ status }: { status: Status }) {
  if (!status.icon) return null;
  const tone =
    status.icon === 'bell'
      ? 'bg-sol text-ink'
      : status.icon === 'check'
        ? 'bg-pasto text-white'
        : 'bg-paper-deep text-ink';
  return (
    <span
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-ink ${tone} ${status.icon === 'check' ? 'animate-pop-in' : ''}`}
    >
      {status.icon === 'bell' ? (
        <BellIcon width="0.9em" height="0.9em" />
      ) : status.icon === 'check' ? (
        <CheckIcon width="0.9em" height="0.9em" />
      ) : (
        <EyeIcon width="0.9em" height="0.9em" />
      )}
    </span>
  );
}

function ScreenReaderStatus({
  player,
  status,
  selfId,
  progress,
}: {
  player: Player;
  status: Status;
  selfId: string;
  progress: string | null;
}) {
  const parts = [
    player.id === selfId ? 'tú' : null,
    player.isHost ? 'anfitrión' : null,
    progress,
    status.label || null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <span className="sr-only"> ({parts.join(', ')})</span>;
}

/** Casillitas que se llenan: el avance de la hoja de un vistazo. */
function Pips({ filled, total }: { filled: number; total: number }) {
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-1.5 rounded-sm border border-ink ${i < filled ? 'bg-pasto' : 'bg-card'}`}
        />
      ))}
    </span>
  );
}

function highlightClass(status: Status): string {
  if (status.tone === 'picker') return 'bg-sol-soft';
  if (status.tone === 'done') return 'bg-pasto-soft';
  return 'bg-card';
}

export function PlayerList({
  players,
  selfId,
  pickerId,
  phase,
  totalCategories,
  variant,
  wrap = false,
  className = '',
}: PlayerListProps) {
  // En la sala de espera y en WRITING se mantiene el orden de llegada: las fichas no saltan con
  // cada tecla. En el resto se ordena por puntaje.
  const keepOrder = variant === 'lobby' || phase === 'WRITING' || phase === 'LETTER';
  const list = keepOrder ? players.map((player) => ({ player, rank: 0 })) : rankByScore(players);

  if (variant === 'chips') {
    return (
      <ul
        aria-label="Jugadores"
        data-testid="player-chips"
        className={`relative flex gap-2 px-3 py-1 ${wrap ? 'flex-wrap' : 'overflow-x-auto'} ${className}`}
      >
        {list.map(({ player }) => {
          const status = statusOf(player, pickerId, phase, totalCategories);
          const writing = phase === 'WRITING' && player.playing;
          const progress = writing ? `${player.filled} de ${totalCategories}` : null;
          return (
            <li
              key={player.id}
              data-player={player.id}
              data-tone={status.tone}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border-2 border-ink py-0.5 pl-1.5 pr-2.5 ${highlightClass(status)} ${player.connected ? '' : 'opacity-75'}`}
            >
              <Avatar id={player.id} name={player.name} size="sm" />
              <span className="flex flex-col leading-tight">
                <span className="max-w-[5.5rem] truncate text-sm font-extrabold">
                  {player.id === selfId && phase === 'WRITING' ? 'Tú' : player.name}
                  <ScreenReaderStatus
                    player={player}
                    status={status}
                    selfId={selfId}
                    progress={progress}
                  />
                </span>
                {writing ? (
                  <span className="flex items-center gap-1.5">
                    <Pips filled={player.filled} total={totalCategories} />
                    <span aria-hidden="true" className="text-xs font-black tabular-nums text-ink">
                      {player.filled}/{totalCategories}
                    </span>
                  </span>
                ) : phase === 'WRITING' ? (
                  <span aria-hidden="true" className="text-xs font-bold text-ink-soft">
                    mira
                  </span>
                ) : (
                  <span className="text-xs font-bold tabular-nums text-ink-soft">
                    {player.score} pts
                  </span>
                )}
              </span>
              <StatusBadge status={status} />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ol
      aria-label="Jugadores"
      data-testid={variant === 'lobby' ? 'lobby-players' : 'player-column'}
      className={`relative ${variant === 'lobby' ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'flex flex-col gap-2'} ${className}`}
    >
      {list.map(({ player, rank }) => {
        const status = statusOf(player, pickerId, phase, totalCategories);
        const subline = [
          player.id === selfId ? 'Tú' : null,
          player.isHost ? 'Anfitrión' : null,
          !player.connected ? 'Sin conexión' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const column = variant === 'column';
        return (
          <li
            key={player.id}
            data-player={player.id}
            data-tone={status.tone}
            className={`flex min-h-12 items-center gap-2 rounded-xl border-2 border-ink px-2.5 py-1.5 ${column ? highlightClass(status) : 'bg-card'} ${player.connected ? '' : 'opacity-75'}`}
          >
            {column && !keepOrder && (
              <span className="w-4 shrink-0 text-center text-sm font-black tabular-nums text-ink-soft">
                {rank}
              </span>
            )}
            <Avatar id={player.id} name={player.name} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-extrabold">
                {player.name}
                <ScreenReaderStatus
                  player={player}
                  status={status}
                  selfId={selfId}
                  progress={
                    phase === 'WRITING' && player.playing
                      ? `${player.filled} de ${totalCategories}`
                      : null
                  }
                />
              </span>
              {subline && (
                <span
                  aria-hidden="true"
                  className="flex items-center gap-1 truncate text-xs font-bold text-ink-soft"
                >
                  {player.isHost && (
                    <CrownIcon width="1em" height="1em" className="shrink-0 text-ink" />
                  )}
                  <span className="truncate">{subline}</span>
                </span>
              )}
            </span>
            <StatusBadge status={status} />
            {column &&
              (phase === 'WRITING' ? (
                player.playing ? (
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span aria-hidden="true" className="text-sm font-black tabular-nums">
                      {player.filled}/{totalCategories}
                    </span>
                    <Pips filled={player.filled} total={totalCategories} />
                  </span>
                ) : (
                  <span aria-hidden="true" className="shrink-0 text-xs font-bold text-ink-soft">
                    mira
                  </span>
                )
              ) : (
                <span className="shrink-0 text-right font-black tabular-nums">
                  {player.score}
                  <span className="ml-0.5 text-xs font-bold text-ink-soft">pts</span>
                </span>
              ))}
          </li>
        );
      })}
    </ol>
  );
}
