import { ANSWER_MAX_LENGTH, type Answers, type Category, type CategoryId } from '@bach/shared';
import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { fieldState, nextEmptyIndex, type FieldState } from '../lib/sheet';
import { CheckIcon } from './icons';

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

type WritingSheetProps = {
  categories: readonly Category[];
  /** Letra de la ronda: marca los campos que no empiezan con ella. */
  letter: string;
  /** Lo que lleva escrito quien mira (campos vacíos pueden faltar). */
  answers: Answers;
  /** Hoja cerrada (STOP o fin del tiempo): los campos no se pueden editar. */
  locked: boolean;
  /**
   * `stack`: categorías apiladas, etiqueta y campo (teléfono; apaisado en dos columnas).
   * `table`: tabla horizontal de cuaderno, una columna por categoría (escritorio).
   */
  layout: 'stack' | 'table';
  /** Enfoca el primer campo vacío al montarse. */
  autoFocus?: boolean;
  /** Cambia cuando cambia el alto visible (teclado): el campo enfocado se vuelve a centrar. */
  viewportKey?: number | null;
  onChange: (category: CategoryId, text: string) => void;
};

/** Franja superior con la espiral del cuaderno: agujeros y argollas de alambre. Decorativa. */
function Spiral() {
  return (
    <div
      aria-hidden="true"
      className="flex h-7 shrink-0 items-end justify-around overflow-hidden border-b-2 border-ink bg-paper-deep px-2 pb-1"
    >
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="relative flex h-5 w-4 items-end justify-center">
          <span className="absolute bottom-0 h-2 w-3.5 rounded-full bg-ink/80" />
          <span className="relative -mb-0.5 h-5 w-1.5 -rotate-12 rounded-full border-2 border-ink bg-card" />
        </span>
      ))}
    </div>
  );
}

const FIELD_TONE: Record<FieldState, string> = {
  empty: 'border-ink bg-card',
  ok: 'border-pasto bg-pasto-soft',
  wrong: 'border-copihue bg-copihue-soft',
};

const CELL_TONE: Record<FieldState, string> = {
  empty: '',
  ok: 'bg-pasto-soft',
  wrong: 'bg-copihue-soft',
};

function FieldNote({ state, letter, id }: { state: FieldState; letter: string; id: string }) {
  if (state === 'wrong') {
    return (
      <span id={id} className="text-xs font-extrabold text-copihue-dark">
        Debe ir con {letter}
      </span>
    );
  }
  if (state === 'ok') {
    return (
      <span id={id} className="inline-flex items-center gap-1 text-xs font-extrabold text-pasto">
        <CheckIcon width="1em" height="1em" aria-hidden="true" />
        <span className="sr-only">Bien, empieza con {letter}</span>
      </span>
    );
  }
  return <span id={id} className="sr-only" />;
}

export function WritingSheet({
  categories,
  letter,
  answers,
  locked,
  layout,
  autoFocus = false,
  viewportKey = null,
  onChange,
}: WritingSheetProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fields = useRef<(FieldElement | null)[]>([]);
  const texts = categories.map((c) => answers[c.id] ?? '');

  // El primer campo vacío toma el foco al empezar la escritura.
  useEffect(() => {
    if (!autoFocus || locked) return;
    const first = fields.current.find((el, i) => el && (texts[i] ?? '').trim() === '');
    first?.focus({ preventScroll: true });
    // Solo al montarse: no debe robar el foco mientras se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con el teclado abierto o cerrado cambia el alto visible: el campo enfocado sigue a la vista.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) {
      active.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [viewportKey]);

  const goNext = (from: number) => {
    const next = nextEmptyIndex(texts, from);
    const target = next >= 0 ? fields.current[next] : null;
    if (target) {
      target.focus();
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      // Nada vacío: se cierra el teclado para que se vea el botón ¡STOP!.
      fields.current[from]?.blur();
    }
  };

  const fieldProps = (index: number, category: Category) => {
    const last = index === categories.length - 1;
    const state = fieldState(texts[index] ?? '', letter);
    const labelId = `sheet-label-${category.id}`;
    const hintId = `sheet-hint-${category.id}`;
    return {
      state,
      labelId,
      hintId,
      common: {
        id: `sheet-field-${category.id}`,
        name: category.id,
        'aria-labelledby': labelId,
        'aria-describedby': hintId,
        'aria-invalid': state === 'wrong',
        'data-state': state,
        value: texts[index] ?? '',
        disabled: locked,
        maxLength: ANSWER_MAX_LENGTH,
        autoComplete: 'off',
        autoCapitalize: 'words',
        autoCorrect: 'off',
        spellCheck: false,
        enterKeyHint: last ? ('done' as const) : ('next' as const),
        ref: (el: FieldElement | null) => {
          fields.current[index] = el;
        },
        onChange: (event: ChangeEvent<FieldElement>) => {
          const raw = event.target.value;
          // Algunos teclados de Android mandan el Enter de un textarea como salto de línea en el texto.
          const lineBreak = /[\r\n]/.test(raw);
          const cleaned = raw.replace(/[\r\n]+/g, ' ').trimStart();
          const text = lineBreak ? cleaned.trimEnd() : cleaned;
          onChange(category.id, text);
          if (lineBreak) goNext(index);
        },
        onKeyDown: (event: KeyboardEvent<FieldElement>) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          goNext(index);
        },
      },
    };
  };

  if (layout === 'table') {
    const columns = `6.5rem repeat(${categories.length}, minmax(0, 1fr))`;
    return (
      <div
        ref={rootRef}
        role="group"
        aria-label="Hoja de respuestas"
        data-testid="writing-sheet"
        data-layout="table"
        className="overflow-hidden rounded-2xl border-2 border-ink bg-card shadow-pop"
      >
        <Spiral />
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="flex items-center justify-center border-b-2 border-ink bg-sol px-2 py-2 text-center text-sm font-black tracking-wide">
            LETRA
          </div>
          {categories.map((category, index) => {
            const { labelId } = fieldProps(index, category);
            return (
              <div
                key={category.id}
                id={labelId}
                className="flex items-center justify-center border-b-2 border-l-2 border-ink bg-sol-soft px-2 py-2 text-center text-sm font-black leading-tight"
              >
                {category.label}
              </div>
            );
          })}
          <div className="flex items-center justify-center bg-paper-deep text-7xl font-black text-copihue">
            <span data-testid="sheet-letter" aria-label={`Letra ${letter}`}>
              {letter}
            </span>
          </div>
          {categories.map((category, index) => {
            const { state, hintId, common } = fieldProps(index, category);
            return (
              <div
                key={category.id}
                className={`sheet-grid relative flex min-h-[max(9rem,26vh)] flex-col border-l-2 border-ink ${CELL_TONE[state]}`}
              >
                <textarea
                  {...common}
                  rows={3}
                  className="min-h-0 w-full flex-1 resize-none bg-transparent px-2.5 pt-2.5 pb-1 text-lg font-bold leading-snug focus-visible:outline-offset-[-3px] disabled:text-ink-soft"
                />
                <div className="flex min-h-6 items-center justify-end px-2 pb-1">
                  <FieldNote state={state} letter={letter} id={hintId} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Hoja de respuestas"
      data-testid="writing-sheet"
      data-layout="stack"
      className="overflow-hidden rounded-2xl border-2 border-ink bg-card shadow-pop"
    >
      <Spiral />
      <div className="sheet-grid sheet-margin grid grid-cols-1 gap-x-3 gap-y-2 py-2.5 pr-3 pl-4 land:grid-cols-2">
        {categories.map((category, index) => {
          const { state, labelId, hintId, common } = fieldProps(index, category);
          return (
            <div key={category.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex min-h-5 items-baseline justify-between gap-2">
                <label id={labelId} htmlFor={common.id} className="text-sm font-extrabold">
                  {category.label}
                </label>
                <FieldNote state={state} letter={letter} id={hintId} />
              </div>
              <input
                {...common}
                type="text"
                className={`h-12 w-full rounded-xl border-2 px-3 text-base font-bold disabled:bg-paper-deep disabled:text-ink-soft ${FIELD_TONE[state]}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
