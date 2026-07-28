'use client'

import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { Project } from '@prisma/client'

interface ProjectsListProps {
  projects: (Project & { environments: any[]; _count: { memberships: number; deployments: number } })[]
}

export function ProjectsList({ projects }: ProjectsListProps) {
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-gray-600">No projects assigned to you yet.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {projects.map((project) => (
        <Link key={project.id} href={`/projects/${project.id}`}>
          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>{project.description}</CardDescription>
                </div>
                {project.color && (
                  <div
                    className="h-8 w-8 rounded-md"
                    style={{ backgroundColor: project.color }}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 text-sm text-gray-600">
                <span>{project.environments.length} environment(s)</span>
                <span>{project._count.deployments} deployment(s)</span>
                <span>{project._count.memberships} member(s)</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
