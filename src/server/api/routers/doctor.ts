import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { department, doctorAvailability, doctorProfile } from "@/server/db/schema";
import {
  createTRPCRouter,
  publicProcedure,
  roleProcedure,
} from "../trpc";

export const doctorRouter = createTRPCRouter({
  // Public: list doctors (with optional department filter)
  list: publicProcedure
    .input(
      z.object({
        departmentId: z.string().uuid().optional(),
        isAvailable: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.doctorProfile.findMany({
        where: and(
          input.departmentId
            ? eq(doctorProfile.departmentId, input.departmentId)
            : undefined,
          input.isAvailable !== undefined
            ? eq(doctorProfile.isAvailable, input.isAvailable)
            : undefined,
        ),
        with: {
          user: { columns: { id: true, name: true, image: true } },
          department: true,
          availability: { where: eq(doctorAvailability.isActive, true) },
        },
      });
    }),

  // Public: get single doctor
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await ctx.db.query.doctorProfile.findFirst({
        where: eq(doctorProfile.id, input.id),
        with: {
          user: { columns: { id: true, name: true, image: true, email: true } },
          department: true,
          availability: { where: eq(doctorAvailability.isActive, true) },
        },
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      return doc;
    }),

  // Doctor: upsert own profile
  upsertMyProfile: roleProcedure("doctor", "admin")
    .input(
      z.object({
        departmentId: z.string().uuid().optional(),
        specialization: z.string().min(2).max(100),
        qualification: z.string().min(2).max(200),
        licenseNumber: z.string().min(4).max(50),
        consultationFee: z.number().min(0),
        bio: z.string().max(1000).optional(),
        isAvailable: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.doctorProfile.findFirst({
        where: eq(doctorProfile.userId, ctx.session.user.id),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(doctorProfile)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(doctorProfile.userId, ctx.session.user.id))
          .returning();
        return updated;
      }

      const [created] = await ctx.db
        .insert(doctorProfile)
        .values({ userId: ctx.session.user.id, ...input })
        .returning();
      return created;
    }),

  // Doctor: set availability slots
  setAvailability: roleProcedure("doctor", "admin")
    .input(
      z.object({
        slots: z.array(
          z.object({
            dayOfWeek: z.number().min(0).max(6),
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
            slotDurationMinutes: z.number().min(10).max(120).default(30),
            isActive: z.boolean().default(true),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doctor = await ctx.db.query.doctorProfile.findFirst({
        where: eq(doctorProfile.userId, ctx.session.user.id),
      });
      if (!doctor) throw new TRPCError({ code: "NOT_FOUND" });

      // Replace all slots for this doctor
      await ctx.db
        .delete(doctorAvailability)
        .where(eq(doctorAvailability.doctorId, doctor.id));

      if (input.slots.length === 0) return [];

      const inserted = await ctx.db
        .insert(doctorAvailability)
        .values(input.slots.map((s) => ({ ...s, doctorId: doctor.id })))
        .returning();

      return inserted;
    }),

  // Admin: list all departments
  listDepartments: publicProcedure.query(({ ctx }) =>
    ctx.db.query.department.findMany({ orderBy: (d, { asc }) => [asc(d.name)] }),
  ),

  // Admin: create department
  createDepartment: roleProcedure("admin")
    .input(
      z.object({
        name: z.string().min(2).max(100),
        description: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(department)
        .values(input)
        .returning();
      return created;
    }),
});