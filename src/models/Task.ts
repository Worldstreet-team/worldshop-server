import { model, Schema, Types, Document } from 'mongoose';

export interface ITask extends Document {
  _id: Types.ObjectId;
  title: string;
  description: string;
  completed: boolean;
}

const TaskSchema = new Schema<ITask>(
  {
    title: {
      type: String,
    },
    description: {
      type: String,
      trim: true,
    },
    completed: {
      type: Boolean,
    },
  },
  {
    timestamps: true,
  },
);

const Task = model('Task', TaskSchema);

export default Task;
