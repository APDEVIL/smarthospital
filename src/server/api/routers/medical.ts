import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  appointment,
  medicalRecord,
  patientProfile,
  prescription,
} from "@/server/db/schema";
import {
  createTRPCRouter,
  protectedProcedure,
  roleProcedure,
} from "../trpc";

const vitalSignsSchema = z.object({
  bp: z.string().optional(),       // e.g. "120/80"
  pulse: z.number().optional(),
  tempC: z.number().optional(),
  weightKg: z.number().optional(),
  spO2: z.number().min(0).max(100).optional(),
});

export const medicalRouter = createTRPCRouter({
  // Doctor creates a medical record for a completed appointment
  createRecord: roleProcedure("doctor", "admin")
    .input(
      z.object({
        appointmentId: z.string().uuid(),
        chiefComplaint: z.string().max(500).optional(),
        diagnosis: z.string().max(2000).optional(),
        symptoms: z.string().max(1000).optional(),
        vitalSigns: vitalSignsSchema.optional(),
        followUpDate: z.string().optional(),
        prescriptions: z
          .array(
            z.object({
              medicationName: z.string().min(1).max(200),
              dosage: z.string().min(1).max(100),
              frequency: z.string().min(1).max(100),
              durationDays: z.number().min(1).max(365).optional(),
              instructions: z.string().max(500).optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const appt = await ctx.db.query.appointment.findFirst({
        where: eq(appointment.id, input.appointmentId),
      });
      if (!appt) throw new TRPCError({ code: "NOT_FOUND" });

      const [record] = await ctx.db
        .insert(medicalRecord)
        .values({
          appointmentId: input.appointmentId,
          patientId: appt.patientId,
          doctorId: appt.doctorId,
          chiefComplaint: input.chiefComplaint,
          diagnosis: input.diagnosis,
          symptoms: input.symptoms,
          vitalSigns: input.vitalSigns
            ? JSON.stringify(input.vitalSigns)
            : undefined,
          followUpDate: input.followUpDate,
        })
        .returning();

      if (input.prescriptions?.length) {
        await ctx.db.insert(prescription).values(
          input.prescriptions.map((p) => ({
            ...p,
            medicalRecordId: record!.id,
            patientId: appt.patientId,
          })),
        );
      }

      // Mark appointment as completed
      await ctx.db
        .update(appointment)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(appointment.id, input.appointmentId));

      return record;
    }),

  // Patient: get own medical history
  getMyHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const patient = await ctx.db.query.patientProfile.findFirst({
        where: eq(patientProfile.userId, ctx.session.user.id),
      });
      if (!patient) return [];

      return ctx.db.query.medicalRecord.findMany({
        where: eq(medicalRecord.patientId, patient.id),
        orderBy: [desc(medicalRecord.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          doctor: { with: { user: { columns: { name: true } } } },
          prescriptions: true,
          appointment: { columns: { scheduledAt: true, reason: true } },
        },
      });
    }),

  // Staff: get a patient's full medical history
  getPatientHistory: roleProcedure("admin", "doctor")
    .input(
      z.object({
        patientId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(10),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.medicalRecord.findMany({
        where: eq(medicalRecord.patientId, input.patientId),
        orderBy: [desc(medicalRecord.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          doctor: { with: { user: { columns: { name: true } } } },
          prescriptions: true,
          appointment: { columns: { scheduledAt: true, reason: true } },
        },
      });
    }),

  // Get single record (doctor or owner patient)
  getRecord: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const record = await ctx.db.query.medicalRecord.findFirst({
        where: eq(medicalRecord.id, input.id),
        with: {
          prescriptions: true,
          doctor: { with: { user: { columns: { name: true, image: true } } } },
          patient: { with: { user: { columns: { name: true } } } },
          appointment: true,
        },
      });

      if (!record) throw new TRPCError({ code: "NOT_FOUND" });

      // Only the patient themselves or staff can see the record
      const role = (ctx.session.user as { role?: string }).role ?? "patient";
      const patient = await ctx.db.query.patientProfile.findFirst({
        where: eq(patientProfile.userId, ctx.session.user.id),
      });

      const isOwner = patient?.id === record.patientId;
      const isStaff = ["admin", "doctor", "receptionist"].includes(role);
      if (!isOwner && !isStaff) throw new TRPCError({ code: "FORBIDDEN" });

      return record;
    }),
});