/** Converts participant counts into operational activity units (rides/slots). */
export function unitsForParticipants(participantCount: number, participantsPerUnit: number): number {
  if (!Number.isInteger(participantCount) || participantCount < 0) {
    throw new RangeError("Participant count must be a non-negative whole number.");
  }
  if (!Number.isInteger(participantsPerUnit) || participantsPerUnit < 1) {
    throw new RangeError("Participants per unit must be a positive whole number.");
  }
  return Math.ceil(participantCount / participantsPerUnit);
}
