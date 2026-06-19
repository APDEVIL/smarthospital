import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { appointment, doctorProfile, patientProfile } from "@/server/db/schema";
import {
  createTRPCRouter,
  protectedProcedure,
  roleProcedure,
} from "../trpc";

export const appointmentRouter = createTRPCRouter({
  // Patient books an appointment
  book: protectedProcedure
    .input(
      z.object({
        doctorId: z.string().uuid(),
        scheduledAt: z.coerce.date(),
        durationMinutes: z.number().min(15).max(120).default(30),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patient = await ctx.db.query.patientProfile.findFirst({
        where: eq(patientProfile.userId, ctx.session.user.id),
      });
      if (!patient) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Complete your patient profile first.",
        });
      }

      const doctor = await ctx.db.query.doctorProfile.findFirst({
        where: eq(doctorProfile.id, input.doctorId),
      });
      if (!doctor?.isAvailable) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Doctor not available." });
      }

      // Conflict check
      const conflict = await ctx.db.query.appointment.findFirst({
        where: and(
          eq(appointment.doctorId, input.doctorId),
          eq(appointment.status, "scheduled"),
          gte(appointment.scheduledAt, input.scheduledAt),
          lte(
            appointment.scheduledAt,
            new Date(input.scheduledAt.getTime() + input.durationMinutes * 60_000),
          ),
        ),
      });
      if (conflict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This slot is already booked.",
        });
      }

      const [created] = await ctx.db
        .insert(appointment)
        .values({
          patientId: patient.id,
          doctorId: input.doctorId,
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
          reason: input.reason,
        })
        .returning();

      return created;
    }),

  // Patient / staff: list own appointments
  listMine: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
          .optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role?: string }).role ?? "patient";

      if (role === "doctor") {
        const doctor = await ctx.db.query.doctorProfile.findFirst({
          where: eq(doctorProfile.userId, ctx.session.user.id),
        });
        if (!doctor) return [];
        return ctx.db.query.appointment.findMany({
          where: and(
            eq(appointment.doctorId, doctor.id),
            input.status ? eq(appointment.status, input.status) : undefined,
          ),
          orderBy: [desc(appointment.scheduledAt)],
          limit: input.limit,
          offset: input.offset,
          with: {
            patient: { with: { user: { columns: { name: true } } } },
          },
        });
      }

      const patient = await ctx.db.query.patientProfile.findFirst({
        where: eq(patientProfile.userId, ctx.session.user.id),
      });
      if (!patient) return [];

      return ctx.db.query.appointment.findMany({
        where: and(
          eq(appointment.patientId, patient.id),
          input.status ? eq(appointment.status, input.status) : undefined,
        ),
        orderBy: [desc(appointment.scheduledAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          doctor: {
            with: { user: { columns: { name: true, image: true } } },
          },
        },
      });
    }),

  // Update status (doctor / receptionist / admin)
  updateStatus: roleProcedure("admin", "doctor", "receptionist")
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum([
          "scheduled",
          "confirmed",
          "completed",
          "cancelled",
          "no_show",
        ]),
        notes: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(appointment)
        .set({
          status: input.status,
          notes: input.notes,
          updatedAt: new Date(),
        })
        .where(eq(appointment.id, input.id))
        .returning();

      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  // Patient cancels own appointment
  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const patient = await ctx.db.query.patientProfile.findFirst({
        where: eq(patientProfile.userId, ctx.session.user.id),
      });
      if (!patient) throw new TRPCError({ code: "UNAUTHORIZED" });

      const appt = await ctx.db.query.appointment.findFirst({
        where: and(
          eq(appointment.id, input.id),
          eq(appointment.patientId, patient.id),
        ),
      });
      if (!appt) throw new TRPCError({ code: "NOT_FOUND" });
      if (appt.status !== "scheduled" && appt.status !== "confirmed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot cancel this appointment.",
        });
      }

      const [updated] = await ctx.db
        .update(appointment)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(appointment.id, input.id))
        .returning();

      return updated;
    }),
});