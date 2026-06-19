import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";

import {
  appointment,
  doctorProfile,
  patientProfile,
  user,
} from "@/server/db/schema";
import { createTRPCRouter, roleProcedure } from "../trpc";

export const adminRouter = createTRPCRouter({
  // Dashboard stats
  getDashboardStats: roleProcedure("admin", "receptionist").query(
    async ({ ctx }) => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

      // Each query is awaited and assigned to its own named variable,
      // then read with `result[0]?.value ?? 0`. This is what fixes the
      // error: the original code destructured `[{ totalPatients }]`
      // directly off a Promise.all array, and because array index
      // access can be `undefined`, TS correctly refused to let you
      // destructure a property off a possibly-undefined value.
      // Reading `?.value` with a fallback sidesteps that entirely.
      const patientsResult = await ctx.db
        .select({ value: count() })
        .from(patientProfile);

      const doctorsResult = await ctx.db
        .select({ value: count() })
        .from(doctorProfile)
        .where(eq(doctorProfile.isAvailable, true));

      const todaysAppointmentsResult = await ctx.db
        .select({ value: count() })
        .from(appointment)
        .where(
          and(
            gte(appointment.scheduledAt, startOfToday),
            lt(appointment.scheduledAt, startOfTomorrow),
          ),
        );

      const pendingAppointmentsResult = await ctx.db
        .select({ value: count() })
        .from(appointment)
        .where(eq(appointment.status, "scheduled"));

      return {
        totalPatients: patientsResult[0]?.value ?? 0,
        totalDoctors: doctorsResult[0]?.value ?? 0,
        totalAppointmentsToday: todaysAppointmentsResult[0]?.value ?? 0,
        pendingAppointments: pendingAppointmentsResult[0]?.value ?? 0,
      };
    },
  ),

  // List all users
  listUsers: roleProcedure("admin")
    .input(
      z.object({
        role: z
          .enum(["admin", "doctor", "receptionist", "patient"])
          .optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.user.findMany({
        where: input.role ? eq(user.role, input.role) : undefined,
        orderBy: [desc(user.createdAt)],
        limit: input.limit,
        offset: input.offset,
        columns: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          image: true,
        },
      });
    }),

  // Change a user's role
  updateUserRole: roleProcedure("admin")
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["admin", "doctor", "receptionist", "patient"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(user)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(user.id, input.userId))
        .returning({ id: user.id, role: user.role });

      return updated;
    }),

  // Recent appointments for dashboard
  getRecentAppointments: roleProcedure("admin", "receptionist")
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.appointment.findMany({
        orderBy: [desc(appointment.createdAt)],
        limit: input.limit,
        with: {
          patient: { with: { user: { columns: { name: true } } } },
          doctor: { with: { user: { columns: { name: true } } } },
        },
      });
    }),
});