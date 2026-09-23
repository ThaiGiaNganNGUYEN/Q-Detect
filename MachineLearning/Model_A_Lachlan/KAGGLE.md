CLI must be logged in as **lachlanbruce** (`kaggle config view` → `username: lachlanbruce`). Switch with `kaggle auth login --force`.

## QGNN kernel (`lachlanbruce/qgnn-ibm-aml`)

Push the kernel (notebook + metadata only; `best_params.json` is attached as dataset `lachlanbruce/qgnn-best-params`):

```
kaggle kernels push -p /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan
```

Create or update the params dataset (use `kaggle_best_params/`, not this folder — a dataset create here would upload `ibmdata.csv` and `.pt` files):

```
# first time:
kaggle datasets create -p /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/kaggle_best_params
# later, after editing best_params.json:
cp /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/best_params.json \
   /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/kaggle_best_params/
kaggle datasets version -p /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/kaggle_best_params -m "update best_params"
```

Dataset slug: `lachlanbruce/qgnn-best-params`. After push, open the kernel on Kaggle and click Run All.

## EDA-IBM kernel (`lachlanbruce/eda-ibm-hi-medium-gnn`)

Separate folder so this push does not overwrite `qgnn-ibm-aml`. Copy the notebook, then push (GPU T4, IBM AML dataset attached):

```
cp /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/EDA-IBM.ipynb \
   /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/kaggle_eda_ibm/
kaggle kernels push -p /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/kaggle_eda_ibm
```

After push, open https://www.kaggle.com/code/lachlanbruce/eda-ibm-hi-medium-gnn and click Run All.
