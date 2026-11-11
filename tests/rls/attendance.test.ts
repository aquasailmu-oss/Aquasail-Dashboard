import { createHash, randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { anon, createFixtures, expectRaised, expectRefused, service, signInAs } from "./harness";

type Session = Awaited<ReturnType<typeof signInAs>>;
let receptionist: Session;
let activityStaff: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  [receptionist, activityStaff] = await Promise.all([signInAs("receptionist"), signInAs("activity_staff")]);
  fx = await createFixtures();

  const bookingUpdate = await service
    .from("bookings")
    .update({
      source_type: "operator",
      payer: "operator",
      operator_id: fx.operator.id,
      operator_net_total_cents: 10_000,
    })
    .eq("id", fx.todayBooking.id);
  if (bookingUpdate.error) throw bookingUpdate.error;

  const participants = await service.from("booking_participants").insert({
    booking_id: fx.todayBooking.id,
    participant_type: "adult",
    count: 5,
  });
  if (participants.error) throw participants.error;
});

describe("booking attendance", () => {
  it("records attendees and a manual operator pre-book reduction without changing the original booking", async () => {
    const result = await receptionist.client.rpc("record_booking_attendance", {
      p_booking_id: fx.todayBooking.id,
      p_adults_present: 3,
      p_children_present: 0,
      p_infants_present: 0,
      p_prebook_reduction_cents: 2_500,
      p_prebook_reduction_reason: "Two guests did not attend",
    });
    expect(result.error).toBeNull();

    const [
      { data: attendance, error: attendanceError },
      { data: booking, error: bookingError },
      { data: row, error: rowError },
    ] = await Promise.all([
      receptionist.client
        .from("booking_attendance")
        .select("adults_expected_count, adults_present_count, prebook_reduction_cents, prebook_reduction_reason")
        .eq("booking_id", fx.todayBooking.id)
        .single(),
      service.from("bookings").select("operator_net_total_cents").eq("id", fx.todayBooking.id).single(),
      receptionist.client
        .from("booking_register")
        .select("people, operator_net_total_cents, prebook_reduction_cents")
        .eq("id", fx.todayBooking.id)
        .single(),
    ]);
    if (attendanceError) throw attendanceError;
    if (bookingError) throw bookingError;
    if (rowError) throw rowError;
    expect(attendance).toMatchObject({
      adults_expected_count: 5,
      adults_present_count: 3,
      prebook_reduction_cents: 2_500,
      prebook_reduction_reason: "Two guests did not attend",
    });
    expect(booking.operator_net_total_cents).toBe(10_000);
    expect(row).toMatchObject({ people: 5, operator_net_total_cents: 7_500, prebook_reduction_cents: 2_500 });

    const token = randomBytes(32).toString("base64url");
    const waiverLink = await service.from("booking_waiver_links").insert({
      booking_id: fx.todayBooking.id,
      token_hash: createHash("sha256").update(token).digest("hex"),
      disclaimer_text: "Approved test wording.",
      expires_on: fx.today,
      created_by: receptionist.userId,
    });
    if (waiverLink.error) throw waiverLink.error;
    const waiverState = await anon.rpc("get_booking_waiver", { p_token: token });
    expect(waiverState.error).toBeNull();
    expect(waiverState.data).toMatchObject({ valid: true, adult_required: 3, required_count: 3 });
  });

  it("saves expected age-group counts with a pre-registration", async () => {
    const result = await receptionist.client.rpc("create_booking_pre_registration", {
      p_first_name: fx.client.first_name,
      p_last_name: fx.client.last_name,
      p_operator_id: fx.operator.id,
      p_service_date: fx.today,
      p_client_id: fx.client.id,
      p_adults_expected_count: 2,
      p_children_expected_count: 1,
      p_infants_expected_count: 1,
    });
    expect(result.error).toBeNull();
    const id = (result.data as { id: string }).id;
    const registration = await receptionist.client
      .from("booking_pre_registrations")
      .select("adults_expected_count, children_expected_count, infants_expected_count")
      .eq("id", id)
      .single();
    expect(registration.error).toBeNull();
    expect(registration.data).toEqual({
      adults_expected_count: 2,
      children_expected_count: 1,
      infants_expected_count: 1,
    });
  });

  it("creates a booking and saves its present counts atomically", async () => {
    const serviceDate = fx.today;
    const quote = await receptionist.client.rpc("build_quote", {
      input: {
        service_date: serviceDate,
        lines: [{ target_type: "activity", target_id: fx.activity.id, participant_type: "adult", quantity: 5 }],
      },
    });
    expect(quote.error).toBeNull();
    const expectedTotal = (quote.data as { charged_total_cents: number }).charged_total_cents;
    const idempotencyKey = randomUUID();
    const create = (adultsPresent: number) =>
      receptionist.client.rpc("create_booking_with_hotel", {
        payload: {
          idempotency_key: idempotencyKey,
          client_id: fx.client.id,
          client: null,
          service_date: serviceDate,
          operator_id: null,
          hotel_name: null,
          lines: [{ target_type: "activity", target_id: fx.activity.id, participant_type: "adult", quantity: 5 }],
          participants: [{ participant_type: "adult", count: 5 }],
          discount: null,
          departure_time: null,
          meeting_point: null,
          notes: null,
          resource_id: null,
          payment: null,
          expected_total_cents: expectedTotal,
          attendance: {
            adults_present: adultsPresent,
            children_present: 0,
            infants_present: 0,
            prebook_reduction_cents: 0,
          },
        },
      });

    const result = await create(3);
    expect(result.error).toBeNull();
    const bookingId = (result.data as { booking_id: string }).booking_id;
    const attendance = await service
      .from("booking_attendance")
      .select("adults_expected_count, adults_present_count")
      .eq("booking_id", bookingId)
      .single();
    expect(attendance.error).toBeNull();
    expect(attendance.data).toEqual({ adults_expected_count: 5, adults_present_count: 3 });

    const rejectedKey = randomUUID();
    const rejected = await receptionist.client.rpc("create_booking_with_hotel", {
      payload: {
        idempotency_key: rejectedKey,
        client_id: fx.client.id,
        client: null,
        service_date: serviceDate,
        operator_id: null,
        hotel_name: null,
        lines: [{ target_type: "activity", target_id: fx.activity.id, participant_type: "adult", quantity: 5 }],
        participants: [{ participant_type: "adult", count: 5 }],
        discount: null,
        departure_time: null,
        meeting_point: null,
        notes: null,
        resource_id: null,
        payment: null,
        expected_total_cents: expectedTotal,
        attendance: {
          adults_present: 6,
          children_present: 0,
          infants_present: 0,
          prebook_reduction_cents: 0,
        },
      },
    });
    expectRaised(rejected, "Attended guests cannot exceed the booked count.");
    const rolledBack = await service.from("bookings").select("id").eq("idempotency_key", rejectedKey).maybeSingle();
    expect(rolledBack.data).toBeNull();
  });

  it("rejects over-attendance and leaves the saved record unchanged", async () => {
    const result = await receptionist.client.rpc("record_booking_attendance", {
      p_booking_id: fx.todayBooking.id,
      p_adults_present: 6,
      p_children_present: 0,
      p_infants_present: 0,
      p_prebook_reduction_cents: 0,
    });
    expectRaised(result, "Attended guests cannot exceed the booked count.");

    const saved = await service
      .from("booking_attendance")
      .select("adults_present_count, prebook_reduction_cents")
      .eq("booking_id", fx.todayBooking.id)
      .single();
    expect(saved.data).toEqual({ adults_present_count: 3, prebook_reduction_cents: 2_500 });
  });

  it("limits writes to the attendance RPC and to admin or reception", async () => {
    expectRefused(
      await receptionist.client.from("booking_attendance").insert({
        booking_id: fx.todayBooking.id,
        adults_expected_count: 5,
        adults_present_count: 5,
        children_expected_count: 0,
        children_present_count: 0,
        infants_expected_count: 0,
        infants_present_count: 0,
      }),
    );

    expectRaised(
      await activityStaff.client.rpc("record_booking_attendance", {
        p_booking_id: fx.todayBooking.id,
        p_adults_present: 3,
        p_children_present: 0,
        p_infants_present: 0,
        p_prebook_reduction_cents: 0,
      }),
      "Only reception or an admin can record attendance.",
    );
  });

  it("rejects a reduction greater than the operator amount", async () => {
    const result = await receptionist.client.rpc("record_booking_attendance", {
      p_booking_id: fx.todayBooking.id,
      p_adults_present: 3,
      p_children_present: 0,
      p_infants_present: 0,
      p_prebook_reduction_cents: 10_001,
    });
    expectRaised(result, "The pre-book reduction cannot exceed the amount the operator owes AquaSail.");
  });

  it("does not allow anonymous callers to write attendance", async () => {
    const result = await anon.rpc("record_booking_attendance", {
      p_booking_id: randomUUID(),
      p_adults_present: 0,
      p_children_present: 0,
      p_infants_present: 0,
      p_prebook_reduction_cents: 0,
    });
    expectRefused(result);
  });
});
