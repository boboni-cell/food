export function matchesFilters(place, {distance, radius, budget, diet, includeUnknownPrice, includeUnknownDiet}) {
  const withinBudget = !budget || (place.price === null ? includeUnknownPrice : place.price <= budget);
  const matchesDiet = diet === 'all' || place.diet === diet || (diet === 'veg' && place.diet === 'mixed') || (diet !== 'veg' && place.diet === 'unknown' && includeUnknownDiet);
  return distance <= radius && withinBudget && matchesDiet;
}
