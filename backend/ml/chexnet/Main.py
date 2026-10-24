import os
import numpy as np
import time
import sys

from ChexnetTrainer import ChexnetTrainer, CLASS_NAMES
from HeatmapGenerator import HeatmapGenerator

#-------------------------------------------------------------------------------- 

def main ():
    # Check if a custom image path is provided via command line
    if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
        pathImage = sys.argv[1]
        runPredictSingle(pathImage)
    else:
        runTest()
  
#--------------------------------------------------------------------------------   

def runPredictSingle(pathImageFile, pathModel='./models/m-25012018-123527.pth.tar', outputPath='test/heatmap.png'):
    if not os.path.exists(pathImageFile):
        print(f"Error: Image file '{pathImageFile}' not found.")
        return
        
    print("=" * 60)
    print("           CheXNet Disease Prediction System            ")
    print("=" * 60)
    print(f"Testing Image     : {pathImageFile}")
    print(f"Pretrained Model  : {pathModel}")
    print("-" * 60)
    
    # 1. Run disease prediction using ChexNet DenseNet-121
    predictions = ChexnetTrainer.predict(pathImageFile, pathModel)
    
    print(f"{'Pathology / Disease':<22} | {'Probability':<12} | {'Confidence Bar'}")
    print("-" * 60)
    
    # Sort predictions by probability descending
    sorted_preds = sorted(predictions.items(), key=lambda x: x[1], reverse=True)
    for name, prob in sorted_preds:
        bar_len = int(prob * 30)
        bar = "#" * bar_len + "-" * (30 - bar_len)
        print(f"{name:<22} | {prob*100:6.2f}% ({prob:.4f}) | [{bar}]")
    
    print("-" * 60)
    top_disease, top_prob = sorted_preds[0]
    print(f"Top Detected Condition: {top_disease} ({top_prob*100:.2f}%)")
    
    # 2. Generate Grad-CAM Heatmap
    try:
        heatmap_gen = HeatmapGenerator(pathModel, 'DENSE-NET-121', 14, 224)
        top_idx = CLASS_NAMES.index(top_disease)
        heatmap_gen.generate(pathImageFile, outputPath, 224, targetClassIndex=top_idx)
        print(f"Class Activation Heatmap saved to: {outputPath}")
    except Exception as e:
        print(f"Notice: Heatmap generation skipped ({e})")
    
    print("=" * 60)

#-------------------------------------------------------------------------------- 

def runTrain():
    
    DENSENET121 = 'DENSE-NET-121'
    DENSENET169 = 'DENSE-NET-169'
    DENSENET201 = 'DENSE-NET-201'
    
    timestampTime = time.strftime("%H%M%S")
    timestampDate = time.strftime("%d%m%Y")
    timestampLaunch = timestampDate + '-' + timestampTime
    
    #---- Path to the directory with images
    pathDirData = './database'
    
    #---- Paths to the files with training, validation and testing sets.
    pathFileTrain = './dataset/train_1.txt'
    pathFileVal = './dataset/val_1.txt'
    pathFileTest = './dataset/test_1.txt'
    
    nnArchitecture = DENSENET121
    nnIsTrained = True
    nnClassCount = 14
    
    trBatchSize = 16
    trMaxEpoch = 100
    
    imgtransResize = 256
    imgtransCrop = 224
        
    pathModel = 'm-' + timestampLaunch + '.pth.tar'
    
    print ('Training NN architecture = ', nnArchitecture)
    ChexnetTrainer.train(pathDirData, pathFileTrain, pathFileVal, nnArchitecture, nnIsTrained, nnClassCount, trBatchSize, trMaxEpoch, imgtransResize, imgtransCrop, timestampLaunch, None)
    
    print ('Testing the trained model')
    ChexnetTrainer.test(pathDirData, pathFileTest, pathModel, nnArchitecture, nnClassCount, nnIsTrained, trBatchSize, imgtransResize, imgtransCrop, timestampLaunch)

#-------------------------------------------------------------------------------- 

def runTest():
    
    pathDirData = './database'
    pathFileTest = './dataset/test_1.txt'
    nnArchitecture = 'DENSE-NET-121'
    nnIsTrained = True
    nnClassCount = 14
    trBatchSize = 16
    imgtransResize = 256
    imgtransCrop = 224
    
    pathModel = './models/m-25012018-123527.pth.tar'
    timestampLaunch = ''
    
    # Run test evaluation
    ChexnetTrainer.test(pathDirData, pathFileTest, pathModel, nnArchitecture, nnClassCount, nnIsTrained, trBatchSize, imgtransResize, imgtransCrop, timestampLaunch)

#-------------------------------------------------------------------------------- 

if __name__ == '__main__':
    main()





