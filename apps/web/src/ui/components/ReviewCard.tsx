import type { Player, ReviewGroup } from '@bach/shared';
import { stampLabel, stampTone, statusNote, voteInfo, type StampTone } from '../lib/review';
import { Avatar } from './Avatar';
import { CloseIcon } from './icons';

type ReviewCardProps = {
  group: ReviewGroup;
  players: readonly Player[];
  selfId: string;
  /** Letra de la ronda (para "No empieza con F"). */
  letter: string;
  /** Marca o desmarca "No vale" en esta respuesta. */
  onVote: (key: string, reject: boolean) => void;
  /** Sin conexión: el botón se bloquea. */
  disabled?: boolean;
};

const STAMP_TONES: Record<StampTone, string> = {
  repeated: 'bg-mar-soft text-ink',
  unique: 'bg-sol text-ink',
  alone: 'bg-pasto text-white',
  none: 'bg-paper-deep text-ink-soft',
};

const BLOCKED_TEXT = {
  author: 'Es tu respuesta',
  spectator: 'Solo miras esta ronda',
  wrong_letter: null,
  no_voters: null,
} as const;

/** Sello redondo de puntos: cambia de color y "se estampa" de nuevo cuando cambia el valor. */
function PointsStamp({ group }: { group: ReviewGroup }) {
  const tone = stampTone(group);
  const value = group.status === 'valid' ? group.points : 0;
  return (
    <div
      key={`${group.status}-${group.points}`}
      data-testid="points-stamp"
      data-tone={tone}
      role="img"
      aria-label={stampLabel(group)}
      className={`flex size-[4.25rem] shrink-0 animate-stamp flex-col items-center justify-center rounded-full border-2 border-ink shadow-pop-sm ${STAMP_TONES[tone]}`}
    >
      <span aria-hidden="true" className="text-2xl leading-none font-black tabular-nums">
        {value}
      </span>
      <span aria-hidden="true" className="text-[0.65rem] font-extrabold tracking-wide uppercase">
        puntos
      </span>
    </div>
  );
}

/**
 * Tarjeta de un grupo de respuestas iguales: el texto, quiénes la escribieron, el sello de
 * puntos en vivo y el botón "No vale" con su contador de votos.
 */
export function ReviewCard({
  group,
  players,
  selfId,
  letter,
  onVote,
  disabled = false,
}: ReviewCardProps) {
  const authors = group.playerIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => p !== undefined);
  const vote = voteInfo(group, players, selfId);
  const note = statusNote(group, letter);
  const dead = group.status !== 'valid';
  const blockedText = vote.blockedReason ? BLOCKED_TEXT[vote.blockedReason] : null;
  const isMine = group.playerIds.includes(selfId);

  return (
    <li
      data-testid="review-card"
      data-status={group.status}
      data-points={group.points}
      className={`flex flex-col gap-2 rounded-2xl border-2 border-ink p-3 shadow-pop-sm ${
        dead ? 'bg-paper-deep' : isMine ? 'bg-mar-soft' : 'bg-card'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p
            data-testid="review-text"
            className={`text-2xl leading-tight font-black break-words ${
              dead ? 'text-ink-soft line-through decoration-copihue decoration-[3px]' : ''
            }`}
          >
            {group.text}
          </p>
          {note && (
            <p
              data-testid="review-note"
              className="inline-flex w-fit items-center gap-1 rounded-full border-2 border-ink bg-copihue-soft px-2.5 py-0.5 text-sm font-extrabold text-copihue-dark"
            >
              <CloseIcon width="0.9em" height="0.9em" />
              {note}
            </p>
          )}
          <ul aria-label="Autores" className="flex flex-wrap gap-1.5">
            {authors.map((author) => (
              <li
                key={author.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border-2 border-ink bg-card py-0.5 pr-2.5 pl-0.5"
              >
                <Avatar id={author.id} name={author.name} size="sm" className="size-6 text-xs" />
                <span className="truncate text-sm font-extrabold">
                  {author.id === selfId ? 'Tú' : author.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <PointsStamp group={group} />
      </div>

      {vote.canVote || blockedText ? (
        <div className="flex items-center justify-between gap-2">
          {vote.canVote ? (
            <button
              type="button"
              onClick={() => onVote(group.key, !vote.voted)}
              disabled={disabled}
              aria-pressed={vote.voted}
              aria-label={`No vale: ${vote.votes} de ${vote.needed} votos necesarios`}
              data-testid="vote-button"
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-ink px-3 font-extrabold shadow-pop-sm transition-[transform,box-shadow,background-color] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:border-ink-soft disabled:bg-paper-deep disabled:text-ink-soft disabled:shadow-none ${
                vote.voted ? 'bg-copihue text-white' : 'bg-card text-ink hover:bg-copihue-soft'
              }`}
            >
              <CloseIcon aria-hidden="true" />
              <span aria-hidden="true">No vale</span>
              <span
                aria-hidden="true"
                className={`rounded-md px-1.5 text-sm font-black tabular-nums ${
                  vote.voted ? 'bg-white/25' : 'bg-paper-deep'
                }`}
              >
                {vote.votes}/{vote.needed}
              </span>
            </button>
          ) : (
            <span data-testid="vote-blocked" className="text-sm font-bold text-ink-soft">
              {blockedText}
            </span>
          )}
          {vote.canVote && group.status === 'rejected' && (
            <span className="text-xs font-bold text-ink-soft">Toca de nuevo para desmarcar</span>
          )}
        </div>
      ) : null}
    </li>
  );
}
