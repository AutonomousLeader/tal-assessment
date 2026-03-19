// Pure function — takes assessment data, returns an array of tag strings.
// No side effects, no I/O. These tags map to Kit.com subscriber tags
// and determine which nurture sequence a contact enters.

function buildTags({ assessmentType, levelResult, flagged, primaryConstraint, superpower }) {
  const tags = [
    "tal-assessment-completed",
    `tal-level-${levelResult}`,
    `tal-type-${assessmentType}`,
  ];

  if (flagged) {
    tags.push("tal-outreach-requested");
  }

  if (assessmentType === "deep" && primaryConstraint) {
    tags.push(`tal-constraint-${primaryConstraint.toLowerCase()}`);
  }

  if (assessmentType === "deep" && superpower) {
    tags.push(`tal-superpower-${superpower.toLowerCase()}`);
  }

  return tags;
}

module.exports = { buildTags };
