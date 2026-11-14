import type { Category, Player, ReviewGroup, RoundEnd } from '@bach/shared';
import { buildRoundRows } from '../lib/roundEnd';
import { stampTone, statusNote, type StampTone } from '../lib/review';
import { Avatar } from './Avatar';
import { ChevronDownIcon, StarIcon } from './icons';

type RoundEndPanelProps = {
  roundEnd: RoundEnd;
  players: readonly Player[];
  categories: readonly Category[];
  selfId: string;
};

const POINT_TONES: Record<StampTone, string> = {
  repeated: 'bg-mar-soft text-ink',
  unique: 'bg-sol text-ink',
  alone: 'bg-pasto text-white',
  none: 'bg-paper-deep text-ink-soft',
};

function nameOf(players: readonly Player[], id: string, selfId: string): string {
  if (id === selfId) return 'Tú';
  return players.find((p) => p.id === id)?.name ?? 'Alguien';
}

function GroupLine({
  group,
  players,
  selfId,
  letter,
}: {
  group: ReviewGroup;
  players: readonly Player[];
  selfId: string;
  letter: string;
}) {
  const dead = group.status !== 'valid';
  const note = statusNote(group, letter);
  const mine = group.playerIds.includes(selfId);
  return (
    <li className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${mine ? 'bg-mar-soft' : ''}`}>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span
          className={`font-extrabold break-words ${dead ? 'text-ink-soft line-through decoration-copihue decoration-2' : ''}`}
        >
          {group.text}
        </span>
        <span className="truncate text-xs font-bold text-ink-soft">
          {group.playerIds.map((id) => nameOf(players, id, selfId)).join(', ')}
          {note ? ` · ${note}` : ''}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-md border-2 border-ink px-1.5 text-sm font-black tabular-nums ${POINT_TONES[stampTone(group)]}`}
      >
        {group.status === 'valid' ? group.points : 0}
      </span>
    </li>
  );
}

/**
 * Fase ROUND_END: tabla de la ronda con los puntos ganados y el acumulado de cada jugador, y el
 * detalle por categoría (desplegable) para revisar qué pasó.
 */
export function RoundEndPanel({ roundEnd, players, categories, selfId }: RoundEndPanelProps) {
  const rows = buildRoundRows(players, roundEnd, selfId);
  const stopper = rows.find((r) => r.isStopper);

  return (
    <div
      data-testid="round-end"
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 desk:px-1"
    >
      <div className="flex flex-col gap-3">
        <p
          data-testid="round-end-stopper"
          className="rounded-xl border-2 border-ink bg-sol-soft px-3 py-2 text-center font-extrabold shadow-pop-sm"
        >
          {stopper
            ? `${stopper.isSelf ? 'Gritaste' : `${stopper.name} gritó`} ¡STOP! con la ${roundEnd.letter}`
            : `Se acabó el tiempo con la ${roundEnd.letter}`}
        </p>

        <ol
          aria-label="Puntos de la ronda"
          data-testid="round-table"
          className="flex flex-col gap-1.5 rounded-2xl border-2 border-ink bg-card p-2 shadow-pop-sm"
        >
          <li
            aria-hidden="true"
            className="flex items-center gap-2 px-2 text-xs font-extrabold tracking-wide text-ink-soft uppercase"
          >
            <span className="w-5" />
            <span className="size-7" />
            <span className="min-w-0 flex-1">Jugador</span>
            <span className="w-16 text-right">Ronda</span>
            <span className="w-16 text-right">Total</span>
          </li>
          {rows.map((row) => (
            <li
              key={row.playerId}
              data-testid="round-row"
              data-player={row.playerId}
              className={`flex min-h-11 items-center gap-2 rounded-xl px-2 py-1 ${row.isSelf ? 'bg-mar-soft' : ''}`}
            >
              <span className="w-5 text-center font-black tabular-nums text-ink-soft">
                {row.rank}
              </span>
              <Avatar id={row.playerId} name={row.name} size="sm" />
              <span className="flex min-w-0 flex-1 items-center gap-1 leading-tight">
                <span className="truncate font-extrabold">
                  {row.name}
                  {row.isSelf && <span className="font-bold text-ink-soft"> (tú)</span>}
                </span>
                {row.isStopper && (
                  <span title="Gritó STOP" className="shrink-0">
                    <StarIcon
                      width="1.1em"
                      height="1.1em"
                      className="text-sol"
                      fill="currentColor"
                      stroke="var(--color-ink)"
                    />
                    <span className="sr-only"> (gritó STOP)</span>
                  </span>
                )}
                {!row.playing && (
                  <span className="shrink-0 text-xs font-bold text-ink-soft">(miraba)</span>
                )}
              </span>
              <span
                data-testid="round-gain"
                className={`w-16 text-right font-black tabular-nums ${row.gain > 0 ? 'text-pasto' : 'text-ink-soft'}`}
              >
                +{row.gain}
              </span>
              <span className="w-16 text-right font-black tabular-nums">{row.score}</span>
            </li>
          ))}
        </ol>

        <section aria-labelledby="round-detail-title" className="flex flex-col gap-1.5">
          <h2 id="round-detail-title" className="px-1 text-sm font-extrabold text-ink-soft">
            Detalle por categoría
          </h2>
          {categories.map((category) => {
            const groups = roundEnd.results[category.id] ?? [];
            return (
              <details
                key={category.id}
                data-testid="round-detail"
                className="group rounded-xl border-2 border-ink bg-card shadow-pop-sm"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-1.5 font-extrabold [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">{category.label}</span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-t-2 border-ink px-1 py-1">
                  {groups.length === 0 ? (
                    <p className="px-2 py-1.5 text-sm font-bold text-ink-soft">
                      Nadie escribió nada.
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {groups.map((group) => (
                        <GroupLine
                          key={group.key}
                          group={group}
                          players={players}
                          selfId={selfId}
                          letter={roundEnd.letter}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            );
          })}
        </section>
      </div>
    </div>
  );
}
