/**
 * Teacher Consultation binding editor for the V2NodePanel. Renders a
 * self-contained section that lets a pipeline author add, edit, and remove a
 * consultation binding for the selected AtomicStage node. The binding lives on
 * the pipeline-level `consultations` array (not on the node) — this editor
 * reads and writes through the draft helpers from `draft.ts`.
 *
 * The Teacher skill selector populates from the pipeline capability catalog and
 * does NOT claim runtime availability — exact Teacher availability depends on
 * the process-provider lane and platform, and the editor defers to the
 * runtime's pre-activation verdict.
 */
import type {
  PipelineCatalogResponse,
  WireConsultationBinding,
  WirePipelineDefinition,
} from '../api/types.js';
import type { ConsultationBindingPatch } from './draft.js';
import {
  IntegerContractField,
  type IntegerContractDraftError,
} from './IntegerContractField.js';

/** Server-side caps from CONSULTATION_SERVER_LIMITS (consultation-contracts.ts). */
const SERVER_MAX_CONSULTATIONS_PER_INVOCATION = 64;
const SERVER_MAX_TEACHER_ATTEMPTS_PER_CONSULTATION = 16;

const DEFAULT_MAX_CONSULTATIONS = 3;
const DEFAULT_MAX_ATTEMPTS = 2;

export function ConsultationBindingEditor({
  stageId,
  definition,
  catalog,
  binding,
  draftErrors,
  resetKey,
  onInvalidChange,
  onAddBinding,
  onPatchBinding,
  onRemoveBinding,
}: {
  stageId: string;
  definition: WirePipelineDefinition;
  catalog: PipelineCatalogResponse | null;
  binding: WireConsultationBinding | undefined;
  draftErrors: Readonly<Record<string, IntegerContractDraftError>>;
  resetKey: string;
  onInvalidChange?: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
  onAddBinding: (binding: WireConsultationBinding) => void;
  onPatchBinding: (sourceStage: string, patch: ConsultationBindingPatch) => void;
  onRemoveBinding: (sourceStage: string) => void;
}) {
  const scope = `consultation:${stageId}`;
  const registryField = (field: string) => `${scope}/${field}`;

  if (!binding) {
    return (
      <section
        class="stage-panel__section"
        data-testid="consultation-binding-editor"
        data-stage={stageId}
        data-state="absent"
      >
        <h4 class="stage-panel__section-title">Teacher Consultation</h4>
        <button
          type="button"
          data-testid="consultation-add-binding"
          onClick={() =>
            onAddBinding({
              sourceStage: stageId,
              teacherSkill: selectDefaultTeacher(catalog),
              maxConsultationsPerInvocation: DEFAULT_MAX_CONSULTATIONS,
              maxTeacherAttemptsPerConsultation: DEFAULT_MAX_ATTEMPTS,
            })
          }
        >
          Add Teacher consultation
        </button>
        <p class="stage-panel__muted">
          Teacher availability is platform-dependent and deferred to the
          runtime's pre-activation verdict.
        </p>
      </section>
    );
  }

  const teacherSkills = (catalog?.skills ?? []).filter(
    (skill) =>
      skill.skillName?.includes('teacher-advisor') ||
      skill.capability?.id?.includes('teacher-advisor')
  );

  return (
    <section
      class="stage-panel__section"
      data-testid="consultation-binding-editor"
      data-stage={stageId}
      data-state="present"
    >
      <h4 class="stage-panel__section-title">Teacher Consultation</h4>

      <label class="stage-panel__field">
        <span>Teacher skill</span>
        <select
          data-testid="consultation-teacher-skill"
          value={binding.teacherSkill}
          onChange={(event) =>
            onPatchBinding(stageId, {
              teacherSkill: (event.target as HTMLSelectElement).value,
            })
          }
        >
          {teacherSkills.length === 0 && (
            <option value={binding.teacherSkill}>
              {binding.teacherSkill} (not in catalog)
            </option>
          )}
          {teacherSkills.map((skill) => (
            <option
              key={skill.skillName}
              value={skill.skillName}
              disabled={!skill.enabled}
            >
              {skill.skillName}
              {skill.enabled ? '' : ' (disabled)'}
            </option>
          ))}
        </select>
      </label>

      <IntegerContractField
        label="Max consultations per invocation"
        value={binding.maxConsultationsPerInvocation}
        minimum={1}
        allowClear={false}
        field={registryField('maxConsultationsPerInvocation')}
        resetKey={resetKey}
        testId="consultation-max-consultations"
        className="stage-panel__field"
        draftError={draftErrors[registryField('maxConsultationsPerInvocation')]}
        onDraftError={(field, error) => onInvalidChange?.(field, error)}
        onValue={(value) => {
          if (value !== null) {
            onPatchBinding(stageId, {
              maxConsultationsPerInvocation: Math.min(
                value,
                SERVER_MAX_CONSULTATIONS_PER_INVOCATION
              ),
            });
          }
        }}
      />

      <IntegerContractField
        label="Max Teacher attempts per consultation"
        value={binding.maxTeacherAttemptsPerConsultation}
        minimum={1}
        allowClear={false}
        field={registryField('maxTeacherAttemptsPerConsultation')}
        resetKey={resetKey}
        testId="consultation-max-attempts"
        className="stage-panel__field"
        draftError={draftErrors[registryField('maxTeacherAttemptsPerConsultation')]}
        onDraftError={(field, error) => onInvalidChange?.(field, error)}
        onValue={(value) => {
          if (value !== null) {
            onPatchBinding(stageId, {
              maxTeacherAttemptsPerConsultation: Math.min(
                value,
                SERVER_MAX_TEACHER_ATTEMPTS_PER_CONSULTATION
              ),
            });
          }
        }}
      />

      <p class="stage-panel__muted">
        Teacher availability is platform-dependent and deferred to the
        runtime's pre-activation verdict.
      </p>

      <button
        type="button"
        data-testid="consultation-remove-binding"
        onClick={() => onRemoveBinding(stageId)}
      >
        Remove Teacher consultation
      </button>
    </section>
  );
}

/**
 * Picks the first enabled Teacher skill from the catalog, or falls back to the
 * conventional id when none is registered.
 */
function selectDefaultTeacher(
  catalog: PipelineCatalogResponse | null
): string {
  const teacherSkills = (catalog?.skills ?? []).filter(
    (skill) =>
      skill.skillName?.includes('teacher-advisor') ||
      skill.capability?.id?.includes('teacher-advisor')
  );
  const enabled = teacherSkills.find((skill) => skill.enabled);
  return (
    enabled?.skillName ??
    teacherSkills[0]?.skillName ??
    'rasen-teacher-advisor'
  );
}
