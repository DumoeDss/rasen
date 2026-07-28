/**
 * Compact navigation mark derived from the canonical Rasen logo in /assets.
 * The drill body follows the active theme foreground while the red cap keeps
 * the brand's fixed accent, including for installed light and dark themes.
 */
export function RasenLogo() {
  return (
    <svg
      class="app-brand__mark"
      viewBox="0 0 296 489"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <path class="app-brand__mark-cap" d="M140 20H178V55L177 56H140Z" />
      <g class="app-brand__mark-body">
        <path
          d="M172 90
             C168 90 164 88 162 86
             C160 82 159 76 158 72
             C153 77 145 79 138 83
             C135 92 133 101 130 108
             C143 102 158 96 172 90Z"
        />
        <path
          d="M191 104
             L117 138
             C114 140 112 143 111 146
             L102 175
             C101 178 103 181 107 182
             C121 186 136 188 150 188
             L198 172
             L123 164
             L198 132Z"
        />
        <path
          d="M218 177
             L140 202
             C119 211 101 219 87 227
             C80 231 76 236 74 241
             L63 279
             C69 284 92 290 143 296
             L227 271
             L109 259
             L227 211Z"
        />
        <path
          d="M254 276
             L122 316
             C91 325 67 336 50 346
             C42 351 37 356 34 361
             L20 412
             L170 468
             L274 429
             L96 388
             L267 323Z"
        />
      </g>
    </svg>
  );
}
