import type { ReviewState, Player } from '@bach/shared';
import { missingAnswerers, pendingReady } from '../lib/review';
import { Button } from './Button';
import { CheckIcon } from './icons';
import { ReviewCard } from './ReviewCard';

type ReviewPanelProps = {
  review: ReviewState;
  players: readonly Player[];
  selfId: string;
  letter: string;
  connected: boolean;
  onVote: (key: string, reject: boolean) => void;
  onReady: (ready: boolean) => void;
};

/**
 * Centro de la fase REVIEW: una tarjeta por grupo de respuestas de la categoría en curso, quiénes
 * la dejaron vacía y la barra con el botón "Listo".
 */
export function ReviewPanel({
  review,
  players,
  selfId,
  letter,
  connected,
  onVote,
  onReady,
}: ReviewPanelProps) {
  const self = players.find((p) => p.id === selfId);
  const playing = self?.playing ?? false;
  const ready = self?.ready ?? false;
  const missing = missingAnswerers(players, review.groups);
  const pending = pendingReady(players);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="review-panel">
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 desk:px-1">
        <ul aria-label="Respuestas" className="flex flex-col gap-3">
          {review.groups.map((group) => (
            <ReviewCard
              key={group.key}
              group={group}
              players={players}
              selfId={selfId}
              letter={letter}
              onVote={onVote}
              disabled={!connected}
            />
          ))}
        </ul>
        {review.groups.length === 0 && (
          <p
            data-testid="review-empty"
            className="rounded-2xl border-2 border-ink bg-card p-4 text-center font-extrabold shadow-pop-sm"
          >
            Nadie escribió nada en esta categoría.
          </p>
        )}
        {missing.length > 0 && review.groups.length > 0 && (
          <p
            data-testid="review-missing"
            className="mt-3 rounded-xl border-2 border-dashed border-ink-soft px-3 py-2 text-sm font-bold text-ink-soft"
          >
            Sin respuesta: {missing.map((p) => p.name).join(', ')}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t-2 border-ink bg-paper-deep px-3 py-2">
        {playing ? (
          <>
            <Button
              variant={ready ? 'secondary' : 'sol'}
              size="lg"
              onClick={() => onReady(!ready)}
              disabled={!connected}
              aria-pressed={ready}
              data-testid="ready-button"
              className={`min-w-32 ${ready ? 'bg-pasto-soft' : ''}`}
            >
              {ready && <CheckIcon aria-hidden="true" />}
              Listo
            </Button>
            <p aria-live="polite" data-testid="ready-hint" className="text-sm font-extrabold">
              {ready
                ? pending > 0
                  ? `Esperando a ${pending} ${pending === 1 ? 'jugador' : 'jugadores'}. Toca otra vez para deshacer.`
                  : '¡Todos listos!'
                : pending > 1
                  ? `Faltan ${pending} por marcar Listo`
                  : 'Falta solo que tú marques Listo'}
            </p>
          </>
        ) : (
          <p data-testid="ready-hint" className="text-sm font-extrabold">
            Esta ronda solo miras: puedes chatear, pero no votar. ¡Juegas desde la próxima!
          </p>
        )}
      </div>
    </div>
  );
}
