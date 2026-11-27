import {
  CATEGORY_GROUPS,
  DISTANCE_OPTIONS,
  isFiltering,
  type CategoryGroup,
  type SuggestionFilter,
} from '../lib/suggestionFilters'

/** The filter panel for the map's suggested places, folded away until opened. */
export function SuggestionFilters({
  filter,
  onChange,
  shown,
  total,
}: {
  filter: SuggestionFilter
  onChange: (filter: SuggestionFilter) => void
  /** Places that pass the filter, and all places fetched. */
  shown: number
  total: number
}) {
  const toggleCategory = (id: CategoryGroup, on: boolean) => {
    const picked = new Set(filter.categories)
    if (on) picked.add(id)
    else picked.delete(id)
    onChange({
      ...filter,
      // Kept in panel order, so the saved filter doesn't depend on clicks.
      categories: CATEGORY_GROUPS.map((group) => group.id).filter((group) =>
        picked.has(group),
      ),
    })
  }
  const filtering = isFiltering(filter)

  return (
    <details className="map-filters">
      <summary>
        Filter suggestions
        {filtering && (
          <span className="map-filters-count">
            {' '}
            ({shown} of {total})
          </span>
        )}
      </summary>
      <fieldset>
        <legend>Show</legend>
        {CATEGORY_GROUPS.map((group) => (
          <label key={group.id}>
            <input
              type="checkbox"
              checked={filter.categories.includes(group.id)}
              onChange={(e) => toggleCategory(group.id, e.target.checked)}
            />
            {group.label}
          </label>
        ))}
      </fieldset>
      <label className="map-filters-distance">
        Distance from route
        <select
          value={String(filter.maxDistanceKm)}
          onChange={(e) => {
            const option = DISTANCE_OPTIONS.find(
              (o) => String(o.km) === e.target.value,
            )
            onChange({ ...filter, maxDistanceKm: option?.km ?? null })
          }}
        >
          {DISTANCE_OPTIONS.map((option) => (
            <option key={String(option.km)} value={String(option.km)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={filter.topPicksOnly}
          onChange={(e) =>
            onChange({ ...filter, topPicksOnly: e.target.checked })
          }
        />
        Top picks only
      </label>
    </details>
  )
}
